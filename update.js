/**
 * 这个脚本本来是用来爬取我自己的一个github page到国内服务器方便访问的，
 * 因为github page访问速度太慢，所以写了这个脚本定时更新github page到国内服务器，
 * 这应该是个爬虫脚本，可以根据需要修改
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./update.config');

const host = config.host;
const protocol = config.protocol;
const _http = protocol === 'https' ? https : http;
const wwwPath = path.resolve(__dirname, './public');
const logPath = path.resolve(__dirname, './log.txt');

// 已经访问过的url列表
const urls = new Set();

// 递归遍历的父url，处理文件内容里的相对目录时使用
let parentOriginUrl;

// 开始下载文件内容时的时间戳，用来计算下载一个文件耗时
let downloadTimestamp = new Date().getTime();

/**
 * 写日志，自动创建日志文件
 * @param {string} str 
 */
function writeLog(str) {
    let content = `=====log start=====\r\ndatetime: ${new Date().toLocaleString()}\r\n${str}\r\n=====log end=====\r\n\r\n`
    fs.appendFileSync(logPath, content);
}

/**
 * 根据url获取文件内容
 * @param {string} url 
 * @returns {Promise<Buffer>}
 */
function getContentByUrl(url) {
    return new Promise((resolve, reject) => {
        const req = _http.get(url, res => {
            if (res.statusCode === 200) {
                let buffer = Buffer.alloc(0);
                res.on('data', chunk => {
                    buffer = Buffer.concat([buffer, chunk]);
                });
                res.on('end', () => {
                    resolve(buffer);
                });
            } else {
                reject(res);
            }
        })
        req.on('error', (err) => {
            reject(err);
        })
    });
}

/**
 * 确保目录存在，如果不存在则递归创建目录
 * @param {string} filePath 
 */
function ensureDirExist(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirExist(dirname);
    try {
        fs.mkdirSync(dirname, { recursive: true });
    } catch (err) {
        writeLog(err.message);
    }
}

/**
 * 将内容写入指定路径的文件，并确保目录存在。
 * @param {string} pathname - 文件路径名
 * @param {string} content - 要写入的内容
 */
function writeFileWidthDirSync(pathname, content = '') {
    ensureDirExist(pathname);
    try {
        fs.writeFileSync(pathname, content);
    } catch (err) {
        writeLog(err.message);
    }
}

/**
 * 判断给定的URL是不是二进制文件
 * 这里单纯判断文件后缀名来判断文件是否是二进制文件，有需要可以扩展
 * 
 * @param {string} url 要判断的URL
 * @returns {boolean} 如果URL是二进制文件则返回true，否则返回false
 */
function isBinFile(url) {
    let regex = /(\/|\.html?|\.css|\.js|\.xml|\.php|\.jsp|\.asp)$/;
    return !regex.test(url);
}

/**
 * 根据URL获取文件类型
 * @param {string} url URL地址
 * @returns {string} 文件类型
 */
function getFiletypeByLocalUrl(url) {
    let filenameArr = url.split('.');
    return filenameArr[filenameArr.length - 1];
}

/**
 * 判断给定的url是否合法的本地url，如果为真则返回一个URL对象，否则返回false
 * 合法url如下:
 * "http://host/example.html"
 * "https://host/example.html"
 * "//host/example.html"
 * "../example.html"
 * "./example.html"
 * "/example.html"
 * "example.html"
 * 
 * 非法url如下:
 * "http://aaaaa/example.html"
 * "//nothost/example.html"
 * "#"
 * "mailto:xxxx"
 * "javascript:xxxx"
 * 
 * @param {string} originUrl  a标签、link标签、script标签的href或src属性的值
 * @returns {URL|Boolean}
 */
function filterUrl(originUrl) {
    // 为默认目录添加index.html
    if (!/\.\w+$/.test(originUrl)) {
        if (originUrl.endsWith('/')) {
            originUrl += 'index.html';
        } else {
            originUrl += '/index.html';
        }
    }

    if (/\?/.test(originUrl)) return false; // url中有参数

    if (/^https?:/.test(originUrl)) { // url以协议开头
        if (new RegExp(host).test(originUrl)) {
            return new URL(originUrl);
        } else {
            return false;
        }
    } else if (/^\/{2}/.test(originUrl)) { // url以不明协议开头
        if (new RegExp(host).test(originUrl)) {
            return new URL(`${protocol}:${originUrl}`);
        } else {
            return false;
        }
    } else if (/^\//.test(originUrl)) { // url以根目录开头
        return new URL(`${protocol}://${host}${originUrl}`);
    } else if (/^\.{0,2}\//.test(originUrl)) { // url以相对目录开头 / ./ ../
        // 转换相对目录为根目录
        if (parentOriginUrl) {
            let { pathname } = new URL(parentOriginUrl);
            let pathnameArr = pathname.split('/').slice(1);
            if (originUrl.startsWith('./')) {
                originUrl = originUrl.replace('./', `/${pathnameArr.slice(0, pathnameArr.length - 1).join('/')}/`);
            } else if (originUrl.startsWith('../')) {
                originUrl = originUrl.replace('../', `/${pathnameArr.slice(0, pathnameArr.length - 2).join('/')}/`);
            }
            return new URL(`${protocol}://${host}${originUrl}`);
        } else {
            return false;
        }

    } else if (/^\w/.test(originUrl)) { // url以字母开头
        if (/^mailto:/.test(originUrl)) {
            return false;
        } else if (/^javascript:/.test(originUrl)) {
            return false;
        } else {
            return new URL(`${protocol}://${host}/${originUrl}`);
        }
    } else {
        return false;
    }
}

/**
 * 遍历网站，下载静态文件，并递归文件内容中引用的url
 * @param {string} originUrl a标签、link标签、script标签的href或src属性的值
 */
async function recursion(originUrl = '/') {
    // 处理url
    let urlObj, url, urlPath;
    try {
        urlObj = filterUrl(originUrl);
        // 中文解码
        url = decodeURIComponent(urlObj.href);
        urlPath = decodeURIComponent(urlObj.pathname);
    } catch (err) {
        writeLog(err.message);
    }
    if (urlObj === false) return;

    if (urls.has(url)) return;
    urls.add(url);

    // 获取文件内容
    let buffer;
    try {
        buffer = await getContentByUrl(url);
    } catch (err) {
        if (err instanceof Error) {
            writeLog(err.message);
        } else {
            if (err.statusCode !== undefined) {
                if (
                    err.statusCode >= 300
                    && err.statusCode < 400
                ) {
                    // 递归处理url
                    parentOriginUrl = url;
                    recursion(err.url);
                } else {
                    writeLog(`${err.url}\r\n${err.statusCode}\r\n${err.statusMessage}`);
                }
            }
        }
    }

    let currentTimestamp = new Date().getTime();
    writeLog(`url: ${url}\r\ntake time: ${(currentTimestamp - downloadTimestamp) / 1000}s`);
    downloadTimestamp = currentTimestamp;

    // 处理文件内容
    if (isBinFile(url)) {
        // 写入文件
        let pathname = path.resolve(__dirname, `${wwwPath}${urlPath}`);
        writeFileWidthDirSync(pathname, buffer);
    } else {
        // 将buffer转为字符串
        if (buffer === undefined) return;
        let fileContent = buffer.toString();

        // 去除协议和域名
        fileContent = fileContent.replace(new RegExp(`(https?:\/\/)?(${host})?`, 'g'), '');

        // 创建文件并写入内容
        let pathname = path.resolve(__dirname, `${wwwPath}${urlPath}`);
        writeFileWidthDirSync(pathname, fileContent);

        let filetype = getFiletypeByLocalUrl(url);

        if (/^html?$/.test(filetype)) {
            // 递归处理html文件中的url
            const regex = /(?:href|src|data-src)=(["'])(.*?)\1/g;
            let match = null;
            while ((match = regex.exec(fileContent)) !== null) {
                let matchUrl = match[2];

                // 递归处理url
                parentOriginUrl = url;
                recursion(matchUrl);
            }
        } else if (/^css$/.test(filetype)) {
            // 递归处理html文件中的url
            const regex = /url\(['"]?([^'"\)]+)['"]?\)/g;
            let match = null;
            while ((match = regex.exec(fileContent)) !== null) {
                let matchUrl = match[1];

                // 递归处理url
                parentOriginUrl = url;
                recursion(matchUrl);
            }
        }
    }
}

async function run() {
    // 清空日志
    fs.writeFileSync(logPath, '');
    recursion().catch(err => writeLog(err.message));

    // 处理无法从递归中获取的url
    for (let url of config.otherUrls) {
        recursion(url).catch(err => writeLog(err.message));
    }
}
run();
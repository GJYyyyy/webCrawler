这是一个使用 nodejs 编写的爬虫程序，主要功能是爬取爬取静态网站到本地，作为镜像站使用。

# 安装依赖

```bash
npm install
```

# 配置

修改`update.config.js`中的配置项，包括要爬取的网站地址，网站协议等，本地镜像站端口号等。

# 运行

```bash
# 爬取网站数据到本地
npm run update

# 启动镜像服务器
npm run start
```

#

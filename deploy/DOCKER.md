# AionUi + AionCore Docker 部署

此部署在一个容器中运行 AionUi WebUI 和同容器内的 AionCore。镜像会从 AionCore 源码编译 Linux 后端，并启用微信通道；浏览器访问 WebUI，容器只对外发布 25808 端口。

## 前置条件

- Windows 已安装并启动 Docker Desktop，使用 Linux 容器引擎。
- AionUi 和修改后的 AionCore 源码放在同一父目录，默认目录名分别是 `AionUi-v2.2.2-retry` 和 `AionCore-v0.2.2-weixin-file-send`。
- Docker Compose v2.17 或更新版本（Compose 需要支持额外构建上下文）。

## 构建并启动

在 AionUi 仓库根目录运行：

```powershell
docker compose -f compose.docker.yml config
docker compose -f compose.docker.yml up -d --build
docker compose -f compose.docker.yml ps
```

第一次构建会从 AionCore 源码编译 Linux 版本，耗时会明显长于后续构建。若 AionCore worktree 不在默认相邻目录，可设置 `AIONCORE_BUILD_CONTEXT` 为其绝对路径后再运行 Compose。

## 登录和访问

查看首次启动的用户名和随机密码：

```powershell
docker compose -f compose.docker.yml logs aionui
```

本机浏览器打开 `http://localhost:25808`。同一局域网的其他设备打开 `http://<运行 Docker 的电脑局域网 IP>:25808`。首次登录后请更改随机密码，并在 WebUI 中配置模型服务；Windows 桌面版保存的模型配置不会自动复制到这个新容器。

容器数据保存在 Docker named volume `aionui_data` 中，包括数据库、模型配置、日志和工作区文件。普通 `docker compose down` 不会删除它；不要运行 `docker compose down -v`，除非确实要清空数据。

## 网络边界

默认发布到所有主机网卡，便于局域网设备访问。仅在可信的局域网或 VPN 中使用明文 HTTP；若要从公网访问，应通过 HTTPS 反向代理或 VPN，并在云防火墙中限制来源。不要直接将该 HTTP 端口暴露到不可信网络。

## 常用命令

```powershell
docker compose -f compose.docker.yml logs -f aionui
docker compose -f compose.docker.yml restart
docker compose -f compose.docker.yml down
```

该模式提供浏览器访问。其他电脑上安装的 AionUi Electron 桌面版仍使用本地 AionCore，不会自动连接这个容器。

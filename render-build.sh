#!/bin/bash

# キャッシュフォルダと不要ファイルを強制削除
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer

# PuppeteerをChromium付きで強制インストール
PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer

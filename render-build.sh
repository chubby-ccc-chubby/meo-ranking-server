#!/bin/bash

# Puppeteerのキャッシュを削除（過去のpuppeteer-coreを一掃）
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer

# Puppeteer + Chromium 強制インストール
PUPPETEER_SKIP_DOWNLOAD=false npm install puppeteer

# 他の依存関係再インストール
npm install

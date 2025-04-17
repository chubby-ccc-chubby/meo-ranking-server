#!/bin/bash

set -e # エラーが発生したらスクリプトを停止する

echo "🧹 Clean up node_modules and puppeteer cache"
rm -rf node_modules package-lock.json /opt/render/.cache/puppeteer || echo "Cache clean skipped or failed"

echo "📦 Installing dependencies (skipping Puppeteer's browser download)"
# PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true を環境変数として設定してnpm installを実行
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm install # package.json に基づいて依存関係をインストール

echo "🔧 Installing specific Chrome browser via puppeteer cli"
# npxコマンドでChromeをインストール
# このコマンドが成功すると、通常はインストールされたChromeのパス情報が出力されるはず
# 念のため、インストール先のキャッシュディレクトリを確認
npx puppeteer browsers install chrome

echo "🔍 Locating installed Chrome executable..."
# インストールされたChromeのパスを探す (Render.comの環境に依存する可能性あり)
# Puppeteer 22以降、キャッシュパスが変更された可能性も考慮
CHROME_PATH=$(find /opt/render/.cache/puppeteer -type f -executable \( -name 'chrome' -o -name 'chrome-linux' \) | head -n 1)

if [ -z "$CHROME_PATH" ]; then
  echo "Error: Chrome executable not found in /opt/render/.cache/puppeteer after installation."
  echo "Please check the build logs for the exact installation path."
  exit 1
fi

echo "✅ Chrome executable found at: $CHROME_PATH"
# このパスをRender.comの環境変数に設定する必要があるため、ログに出力しておく
# (ビルドスクリプト内でexportしても実行環境には引き継がれないため)

echo "✅ Build process complete"
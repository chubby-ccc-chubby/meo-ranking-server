# 1. ベースイメージを選択 (Render.comの設定に合わせて Node 22 を使用)
FROM node:22-slim

# 2. 作業ディレクトリを設定
WORKDIR /usr/src/app

# 3. 必要なOS依存ライブラリをインストール
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 \
    libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
    libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
    lsb-release wget xdg-utils procps curl vim \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 4. プロジェクトの依存関係定義ファイルを先にコピー
COPY package.json package-lock.json* ./

# 5. Node.jsの依存関係をインストール (本番用に devDependencies を除外)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm install --omit=dev --no-package-lock --no-save

# 6. @puppeteer/browsers を使ってChromeをインストール (安定版)
RUN npx @puppeteer/browsers install chrome@stable

# 7. 実行パスを環境変数として設定 (★ビルドログで確認したパスを使用★)
ENV PUPPETEER_EXECUTABLE_PATH=/root/.cache/puppeteer/chrome/linux-135.0.7049.84/chrome-linux64/chrome

# 8. アプリケーションコード全体を作業ディレクトリにコピー
COPY . .

# 9. Render.comが期待するポートを公開し、環境変数を設定
EXPOSE 10000
ENV PORT=10000
ENV NODE_ENV=production

# 10. アプリケーションの起動コマンド
CMD ["node", "server.js"]

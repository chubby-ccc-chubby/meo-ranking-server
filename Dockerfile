FROM node:18-bullseye-slim

# リポジトリ情報を更新してChrome関連の依存パッケージをインストール
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils \
    # デバッグ用の追加ツール
    curl \
    vim \
    procps \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 作業ディレクトリの設定
WORKDIR /app

# パッケージファイルをコピーして依存関係をインストール
COPY package*.json ./
RUN npm install

# Chromiumをスキップしてアプリ内でインストールする
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# 特定のChrome/Chromiumバージョンをインストール
RUN npx puppeteer browsers install chrome
ENV PUPPETEER_EXECUTABLE_PATH=/root/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome

# アプリケーションのコードをコピー
COPY . .

# 必要な環境変数を設定
ENV NODE_ENV=production
ENV PORT=3000

# ポートを公開
EXPOSE 3000

# アプリケーションを起動
CMD ["node", "server.js"]
// server.js にヘルスチェックエンドポイントを追加
// 既存のコードに以下を追加

// ヘルスチェックエンドポイント（Render.comのヘルスチェック用）
app.get('/health', (req, res) => {
  // ヘルスチェックの一環としてChrome/Puppeteerの環境確認も実施できます
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  const status = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    puppeteer: {
      executablePath: execPath,
      exists: execPath ? require('fs').existsSync(execPath) : false
    },
    node: process.version,
    memory: process.memoryUsage(),
  };

  res.status(200).json(status);
});

// デバッグ/環境情報エンドポイント（開発中のみ使用）
app.get('/debug', (req, res) => {
  const debugInfo = {
    env: process.env,
    cwd: process.cwd(),
    dir: __dirname,
    platform: process.platform,
    arch: process.arch,
    // ディレクトリ内のファイル一覧（デバッグ用）
    files: require('fs').readdirSync(process.cwd()),
  };

  // PUPPETEER_EXECUTABLE_PATHが存在する場合、そのディレクトリを確認
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (execPath) {
    try {
      // パスを正規化して親ディレクトリを取得
      const pathParts = execPath.split('/');
      const parentDir = pathParts.slice(0, -1).join('/');
      
      if (require('fs').existsSync(parentDir)) {
        debugInfo.chromeDirContents = require('fs').readdirSync(parentDir);
      } else {
        debugInfo.chromeDirError = `Directory ${parentDir} does not exist.`;
      }
    } catch (error) {
      debugInfo.chromeDirError = error.toString();
    }
  }

  res.status(200).json(debugInfo);
});
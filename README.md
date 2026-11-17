# Not DeepSeek Harness

Not DeepSeek Harness（略称 NDSH、コマンド名 `dsh`）は、すべてをプラグインとして組み立てるエージェントハーネスです。[DeepSeek AI](https://deepseek.com) が開発する [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) をもとに、手元で使うための変更を加えています。基盤には [Cordis](https://github.com/cordiverse/cordis) を使っていて、その設計は論文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512) で説明されています。

まだ開発者プレビューの段階で、互換性を壊す変更が入ることがあります。実行する前に[安全に関する注意](SAFETY.md)を読んでください。

## 本家との違い

- **ベンダーのサービスに送らない**：DeepSeek アカウントでのログイン、自動アップデート、セッションログのアップロード、テレメトリ、プロダクト分析を取り除いています。モデルの利用には API キーを使います。
- **データの置き場所が別**：設定やセッションは `~/.ndsh` に保存し、本家アプリの `~/.dsh` には触れません。デスクトップアプリは実行ファイル、インストール先、ショートカットのいずれも「Not DeepSeek Harness」という名前で、アプリのデータは `ndsh-desktop` というフォルダに保存します。
- **設定画面の追加**：プラグイン画面から、MCP サーバーとスキルを管理できます。スキルは ZIP でのインポートとエクスポートにも対応しています。
- **特定のベンダーを前提にしない**：既定のモデルは設定されていません。初めて起動すると、使いたいモデルのプロバイダーを追加する画面がアプリ内に表示されます。DeepSeek はその選択肢の一つで、ほかのプロバイダーと同じように追加・削除できます。会話画面で最初に選んだモデルが既定になります。Web 検索にも既定のプロバイダーはありません。
- **安全のための確認**：シェルコマンドが `git push` を実行する前に、ユーザーに確認します。
- **日本語環境向けの調整**：中国語以外のロケールでは、日本語を表示できるフォントを使います。

<a id="run"></a><a id="run-from-source"></a>

## ソースから起動する

[Node.js](https://nodejs.org/) 24.9 以降と [pnpm](https://pnpm.io/) を用意してから、リポジトリで次を実行します。

```sh
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` でビルド成果物を用意し、`pnpm dsh web` はそれを使って Web UI を起動します（既定では `http://127.0.0.1:3080`）。初回はプロバイダーの追加画面が開くので、プロバイダーを選んで API キーを入力し、会話画面でモデルを選んでください。使い方は [Web UI ガイド](docs/user/guide/index.md)を見てください。

デスクトップアプリは `pnpm run dev:desktop` で開発用に起動できます。インストーラーの作り方は[パッケージングの説明](apps/desktop/packaging/README.md)にあります。

## 開発

[開発ガイド](docs/development.md)と[アーキテクチャの説明](docs/architecture.md)から読み始めてください。エージェントには [AGENTS.md](AGENTS.md) に従ってもらいます。README 以外のドキュメントは英語で書いています。

## ライセンス

[MIT](LICENSE)

依存しているサードパーティのパッケージとそのライセンスは、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にまとめています。

/**
 * AI音声メモ → Googleドキュメント保存（任意・上級向け）
 *
 * 役割: アプリから送られてきた清書テキストを、Google Drive 内の
 *       1つの Google ドキュメント（既定名: AI音声メモ ログ）に日時付きで追記する。
 *
 * 使い方（READMEのGAS手順を参照）:
 *   1. https://script.google.com で新規プロジェクト → このコードを貼り付け
 *   2. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *      - 実行ユーザー: 自分
 *      - アクセスできるユーザー: 全員
 *   3. 発行された /exec URL をアプリの設定「GAS Web App URL」に貼る
 *
 * 注意: アプリ側は no-cors の text/plain POST で送るため、本文は
 *       e.postData.contents に JSON 文字列として届く。
 */

var DOC_NAME = 'AI音声メモ ログ'; // 追記先のGoogleドキュメント名（好きに変更可）

function doPost(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = JSON.parse(raw);
    var text = (data.text || '').toString();
    if (!text.trim()) return json_({ ok: false, error: 'empty text' });

    var at = data.at ? new Date(data.at) : new Date();
    var tz = Session.getScriptTimeZone() || 'Asia/Tokyo';
    var stamp = Utilities.formatDate(at, tz, 'yyyy-MM-dd HH:mm');

    var doc = getOrCreateDoc_(DOC_NAME);
    var body = doc.getBody();
    body.appendParagraph('■ ' + stamp).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    body.appendParagraph(text);
    body.appendParagraph('');
    doc.saveAndClose();

    return json_({ ok: true, doc: doc.getName() });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return json_({ ok: true, info: 'AI音声メモ Drive保存エンドポイント（POSTで追記）' });
}

function getOrCreateDoc_(name) {
  var it = DriveApp.getFilesByName(name);
  if (it.hasNext()) return DocumentApp.openById(it.next().getId());
  return DocumentApp.create(name);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

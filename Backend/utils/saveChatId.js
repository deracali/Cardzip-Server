// utils/saveChatId.js
import fs from 'fs';

const file = 'chat_ids.json';

export function saveUserChatId(chatId) {
  let ids = [];
  if (fs.existsSync(file)) {
    ids = JSON.parse(fs.readFileSync(file));
  }

  if (!ids.includes(chatId)) {
    ids.push(chatId);
    fs.writeFileSync(file, JSON.stringify(ids, null, 2));
    console.log(`✅ Saved new chat ID: ${chatId}`);
  }
}

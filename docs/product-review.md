# YAT 產品與競品 Review（2026-05-03）

本文件整理本次針對 YAT（Yet Another Typeless）的產品定位、競品觀察、現況盤點與後續改善優先序。目標是讓專案維持「不足的補上、過度的移除」：先把核心語音輸入工作流做到穩定、透明、低干擾，再逐步加入真正能改善使用者體驗的能力。

## 參考產品與主要觀察

| 類型 | 代表產品 | 值得借鏡的能力 | YAT 現況 |
| --- | --- | --- | --- |
| 智慧語音輸入 | Typeless | 全域可用、去贅詞/去重複、自我修正、自動格式化、個人字典、100+ 語言、依 App 調整語氣、選取文字語音編輯 | 已具備全域熱鍵、STT→LLM 潤飾、詞彙表、可選上下文；尚未具備「依 App 自動套用不同模式」與選取文字命令 UI |
| AI dictation / 團隊導向 | Wispr Flow | 跨平台、AI auto-edit、個人/共享字典、snippets、IDE/開發者工作流、企業合規 | YAT 採 BYOK 與本地歷史，較適合個人/開源；不建議短期追企業管理功能 |
| Power user / 模式系統 | Superwhisper | 預設模式、自訂模式、離線模型、檔案轉錄、會議助理、開發者語音工作流 | YAT 已有提示詞與詞彙表，但仍偏全域設定；可優先補「輕量模式/工作流 presets」而非完整模式平台 |
| 開源/隱私優先 | OpenWhispr | 本地模型、BYOK、開源、字典、離線、跨 App、音訊上傳/筆記 | YAT 的 BYOK 與本機資料方向吻合；可補強本地模型安裝/引導，但不要先做雲端帳號系統 |
| OS 內建語音輸入 | Windows Voice Access、Apple Dictation | 免設定、系統級穩定、基本 dictation | YAT 應以「AI 清理、可攜設定、詞彙、上下文」差異化，不必取代完整 voice control |

參考來源：

- Typeless：<https://www.typeless.com/>、<https://www.typeless.com/use-cases>
- Wispr Flow：<https://wisprflow.ai/>、<https://wisprflow.ai/comparison/superwhisper-alternative>
- Superwhisper：<https://superwhisper.com/>、<https://superwhisper.com/use-cases>
- OpenWhispr：<https://openwhispr.com/>、<https://openwhispr.com/compare>

## YAT 目前定位

YAT 最適合定位為：**隱私優先、BYOK、跨平台、低干擾的桌面語音輸入層**。

已具備的核心能力：

- 全域快捷鍵錄音（按住說話、單按、雙擊、組合鍵）。
- STT 後可選 LLM 潤飾，支援 OpenAI 相容端點。
- 自動貼上或僅複製到剪貼簿，貼上失敗會降級到剪貼簿。
- 詞彙表與自訂提示詞。
- 可選參考資訊：剪貼簿、選取文字、前景 App、輸入框、截圖。
- 本機歷史紀錄與可選音訊保留，支援重新潤飾/重新轉錄。
- 系統權限總覽（麥克風、macOS 輔助使用/螢幕錄製、Linux 外部工具）。
- 膠囊狀態視窗已採 always-on-top、focusable false、ignore cursor events，避免阻擋背後滑鼠操作。
- 設定/詞彙表 JSON 匯入匯出；API Key 不匯出並由 OS credential store 保存。

## 本次 Review 已落地改善

- 修正前端設定儲存狀態：正常 autosave 成功後不再永久停在 dirty/pending。
- 總覽與側欄改用「STT 就緒 + 啟用中的 LLM 就緒」判斷，避免文字潤飾開啟但未設定時仍顯示已可用。
- 總覽 checklist 會在文字潤飾開啟時明確列出 LLM 設定狀態。
- 膠囊小視窗預設尺寸加大並先設為忽略滑鼠事件再顯示，降低初始閃爍/裁切與點擊攔截風險。
- 縮短膠囊狀態標籤，詳細說明保留在第二行提示。
- 補強部分裝飾元素的 `aria-hidden`，並修正 toast close hover 顏色 token。

## 重要缺口與建議優先序

### P0：核心可用性與信任

1. **設定與狀態必須永遠可信**
   設定是否已儲存、STT/LLM 是否可用、是否需要權限，都要在總覽與相關分頁一致顯示。

2. **膠囊狀態只傳達必要資訊**
   錄音、辨識、潤飾、完成、剪貼簿降級、錯誤/無語音即可。避免塞入太長訊息；長訊息放 detail。

3. **失敗時提供下一步**
   自動貼上失敗、權限不足、STT/LLM 連線錯誤都應告訴使用者下一步：改剪貼簿、開系統設定、補 API key、檢查模型名稱。

### P1：真正提升 workflow 的功能

1. **輕量工作流模式 / presets**
   先做「訊息、Email、筆記、開發者提示、會議筆記」等 presets；可手動選擇或依 App 建議，不急著做完整 mode platform。

2. **依 App 的提示詞偏好**
   Typeless / Superwhisper 的核心差異化之一是同一段語音在 Slack、Gmail、Cursor 中應輸出不同風格。YAT 已能擷取 active app，可在此基礎上加 per-app profile。

3. **剪貼簿/選取文字命令模式 UI**
   目前 prompt 已支援「明確 transformation command」。可加入更清楚的 UI 文案與快捷 workflow：選文字 → 按熱鍵 → 說「縮短/改正式/翻譯」。

4. **第一次設定引導**
   目前 Overview 已能導向，但可加入「測試錄音 → 測試貼上 → 完成」的 guided flow，降低新手迷路感。

### P2：進階但需避免過度設計

1. **本地模型管理**
   可支援本地端點與 BYOK，但完整模型下載器/runner 會明顯增加維護成本；應等核心 dictation 穩定後再做。

2. **檔案/會議轉錄**
   Superwhisper/OpenWhispr 都有這類能力，但 YAT 的主線是「全域語音輸入」。若要做，建議另開明確分頁，不要塞進主要錄音流程。

3. **snippets / voice shortcuts**
   對 power users 有價值，但容易變成第二套文字展開器。建議等 presets/per-app profile 穩定後再評估。

4. **團隊、同步、合規管理**
   目前不符合 YAT 的 BYOK/本機優先定位，短期不建議投入。

## 不建議短期加入或應保持簡化的部分

- 不要先做帳號系統、雲端同步或團隊管理；這會破壞 BYOK/本機優先的簡潔定位。
- 不要把所有 competitor feature 都塞進 General 設定；高階功能應保持折疊，並用情境提示引導。
- 不要預設開啟截圖、選取文字、輸入框全文等上下文來源；隱私與成本風險太高，維持 opt-in。
- 不要把 YAT 做成完整 voice control/agent 瀏覽器；主線仍是「說完就有可用文字」。

## UX 原則

- **低干擾**：錄音狀態要清楚，但不攔截滑鼠、不搶焦點、不打斷輸入。
- **可預期**：按下熱鍵後使用者要知道現在是錄音、辨識、潤飾或完成。
- **可恢復**：貼上失敗也要保證文字在剪貼簿；設定失敗不能吞掉使用者變更。
- **隱私先行**：任何額外上下文都需明確 opt-in，並在 UI 提醒會送出的資料。
- **漸進揭露**：一般使用者只需要 STT、輸出與熱鍵；power user 功能應收在進階區或 presets。

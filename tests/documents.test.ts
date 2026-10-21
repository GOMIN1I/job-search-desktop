import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { extractText, toDocx } from "../src/docs/files";

const F = path.join(__dirname, "fixtures", "docs");

describe("документы: извлечение текста и DOCX (настоящие файлы, кириллица)", () => {
  it("DOCX, созданный другой программой (textutil macOS)", async () => {
    const r = await extractText(path.join(F, "cv-cyrillic.docx"));
    expect(r.status).toBe("ok");
    expect(r.text).toContain("Алекс Пример — резюме");
    expect(r.text).toContain("«Синт Вижн»");
  });
  it("PDF с текстовым слоем (печать Chrome), две страницы", async () => {
    const r = await extractText(path.join(F, "cv-cyrillic.pdf"));
    expect(r.status).toBe("ok");
    expect(r.pages).toBe(2);
    expect(r.text).toContain("разметка данных");
    expect(r.text).toContain("Вторая страница");
  });
  it("PDF-скан без текста — понятное сообщение про распознавание, а не пустой документ", async () => {
    const r = await extractText(path.join(F, "scan-no-text.pdf"));
    expect(r.status).toBe("needs_ocr");
    expect(r.message.ru).toMatch(/скан|распознайте/i);
  });
  it("неподдерживаемый формат сохраняется с объяснением", async () => {
    const p = path.join(os.tmpdir(), "jsd-x.rtf");
    fs.writeFileSync(p, "{\\rtf1 test}");
    expect((await extractText(p)).status).toBe("unsupported");
  });
  it("экспорт в DOCX: открывается и читается обратно, заголовки и списки сохраняются", async () => {
    const buf = await toDocx("Письмо — Синт Вижн", "# Здравствуйте\nМеня зовут Алекс.\n- Разметка: 1 200 задач\n- SQL, Excel\n\nС уважением, Алекс");
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // это ZIP-контейнер DOCX
    const p = path.join(os.tmpdir(), "jsd-export-test.docx");
    fs.writeFileSync(p, buf);
    const back = await extractText(p);
    expect(back.text).toContain("Письмо — Синт Вижн");
    expect(back.text).toContain("Разметка: 1 200 задач");
    expect(back.text).toContain("С уважением, Алекс");
  });
});

// Ролик «Маркер»: бумага, чернила и три маркера — тот же язык, что в приложении.
// Время каждой сцены и звуков берётся из timeline.json (общего с audio/compose.py).
import React, { useEffect, useState } from "react";
import {
  AbsoluteFill, Easing, Img, OffthreadVideo, Sequence, continueRender, delayRender,
  interpolate, spring, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";
import tl from "../timeline.json";

type Lang = "ru" | "en";
const C = {
  paper: "#F6F8F4", surface: "#FFFFFF", sunk: "#EDF1EC", line: "#DCE3DD",
  ink: "#1C2226", soft: "#55615F", pine: "#0B5D4B", yes: "#D8F04A", ask: "#FFCD5A", no: "#F5A3AF",
};
const FONT = "'Golos', system-ui, sans-serif";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scene = (id: string): any => tl.scenes.find((s) => s.id === id)!;
const sec = (s: number) => Math.round(s * tl.fps);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = Easing.bezier(0.22, 1, 0.36, 1);

// --- шрифт ---
const FONT_CSS = `
@font-face{font-family:'Golos';font-weight:400 900;font-display:block;src:url(${staticFile("golos-text-cyrillic-wght-normal.woff2")}) format('woff2');unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
@font-face{font-family:'Golos';font-weight:400 900;font-display:block;src:url(${staticFile("golos-text-latin-wght-normal.woff2")}) format('woff2');unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}`;
const Fonts: React.FC = () => {
  const [handle] = useState(() => delayRender("fonts"));
  useEffect(() => {
    Promise.all([document.fonts.load("600 40px Golos", "Аб"), document.fonts.load("600 40px Golos", "Ab")])
      .then(() => continueRender(handle)).catch(() => continueRender(handle));
  }, [handle]);
  return <style>{FONT_CSS}</style>;
};

// --- маркер: проводится слева направо ---
const Mark: React.FC<{ p: number; color?: string; children: React.ReactNode; h?: string }> = ({ p, color = C.yes, children, h = "0.62em" }) => (
  <span style={{
    backgroundImage: `linear-gradient(${color}, ${color})`, backgroundRepeat: "no-repeat",
    backgroundSize: `${Math.max(0, Math.min(1, p)) * 100}% ${h}`, backgroundPosition: "0 82%",
    padding: "0 0.06em", margin: "0 -0.06em", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
  }}>{children}</span>
);

// Появление: мягкий подъём на 14 px
const useRise = (delay = 0) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f - delay, fps, config: { damping: 200, mass: 0.7 } });
  return { opacity: s, transform: `translateY(${(1 - s) * 14}px)` };
};
const wipe = (f: number, from: number, len = 16) => interpolate(f, [from, from + len], [0, 1], { ...clamp, easing: ease });

// Затухание на стыках сцен
const SceneFade: React.FC<{ len: number; children: React.ReactNode; out?: boolean }> = ({ len, children, out = true }) => {
  const f = useCurrentFrame();
  const o = Math.min(interpolate(f, [0, 8], [0, 1], clamp), out ? interpolate(f, [len - 8, len], [1, 0], clamp) : 1);
  return <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>;
};

const Caption: React.FC<{ title: string; sub?: string; mark?: boolean; width?: number; size?: number }> = ({ title, sub, mark = true, width = 560, size = 68 }) => {
  const f = useCurrentFrame();
  const a = useRise(4);
  const b = useRise(14);
  return (
    <div style={{ width, fontFamily: FONT, color: C.ink }}>
      <div style={{ ...a, fontSize: size, lineHeight: 1.08, fontWeight: 650, letterSpacing: "-0.02em" }}>
        {mark ? <Mark p={wipe(f, 12, 18)}>{title}</Mark> : title}
      </div>
      {sub && <div style={{ ...b, marginTop: 28, fontSize: 30, lineHeight: 1.38, color: C.soft, fontWeight: 450 }}>{sub}</div>}
    </div>
  );
};

const Window: React.FC<{ w: number; children: React.ReactNode; title?: string }> = ({ w, children, title = "Job Search Desktop" }) => {
  const h = Math.round((w * 800) / 1280);
  return (
    <div style={{ width: w, borderRadius: 18, overflow: "hidden", background: C.surface, border: `1.5px solid ${C.line}`,
      boxShadow: "0 40px 90px -30px rgba(28,34,38,0.28), 0 2px 0 rgba(28,34,38,0.03)" }}>
      <div style={{ height: 38, background: C.sunk, borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10, padding: "0 16px",
        fontFamily: FONT, fontSize: 15, color: C.soft, fontWeight: 550 }}>
        <Img src={staticFile("icon.svg")} style={{ width: 18, height: 18 }} />{title}
      </div>
      <div style={{ width: w, height: h, position: "relative", overflow: "hidden" }}>{children}</div>
    </div>
  );
};

const Tag: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ fontFamily: FONT, fontSize: 19, color: C.soft, display: "inline-flex", alignItems: "center", gap: 10 }}>
    <span style={{ width: 9, height: 9, borderRadius: 9, background: C.pine, display: "inline-block" }} />{text}
  </div>
);

// --- 1. стена объявлений ---
const WALL = [
  "Customer Support Specialist", "Data Entry Clerk", "Junior QA Tester", "AI Training Data Reviewer", "Content Moderator",
  "Virtual Assistant", "Chat Support Agent", "Junior Data Analyst", "Technical Writer", "Back Office Assistant",
  "Search Quality Rater", "Operations Coordinator", "Product Support Associate", "Transcriptionist", "HR Assistant",
  "Marketplace Specialist", "Junior Business Analyst", "Annotation Specialist", "Email Support Representative", "Localization Tester",
  "Project Coordinator", "Prompt Evaluator", "Sales Development Rep", "Catalog Specialist", "Research Assistant",
  "Junior 1C Consultant", "Social Media Assistant", "Trust & Safety Analyst", "Onboarding Specialist", "Help Desk Technician",
];
const META = ["Remote, worldwide", "Hybrid, Warsaw", "Remote, EU only", "On-site", "Remote, US only", "Remote, CIS", "Hybrid, Almaty", "Remote, LATAM"];
const PAY = ["$600–900 / mo", "Pay not stated", "€1,200 / mo", "$15 / hour", "Negotiable", "₽60 000 / мес", "$2,000 / mo", "Commission"];

const Wall: React.FC<{ lang: Lang; len: number }> = ({ lang, len }) => {
  const f = useCurrentFrame();
  const y = interpolate(f, [0, len], [0, -260]);
  const t = scene("wall")[lang];
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", inset: 0, transform: `translateY(${y}px) rotate(-2deg) scale(1.08)`, display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)", gap: "26px 34px", padding: "40px 60px" }}>
        {Array.from({ length: 64 }, (_, i) => (
          <div key={i} style={{ fontFamily: FONT, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: "18px 20px", opacity: 0.85 }}>
            <div style={{ fontSize: 21, fontWeight: 600, color: C.ink, opacity: 0.55 }}>{WALL[(i * 7) % WALL.length]}</div>
            <div style={{ fontSize: 16, color: C.soft, opacity: 0.6, marginTop: 6 }}>{META[(i * 3) % META.length]}, {PAY[(i * 5) % PAY.length]}</div>
            <div style={{ height: 7, width: `${55 + ((i * 13) % 40)}%`, background: C.sunk, borderRadius: 4, marginTop: 12 }} />
            <div style={{ height: 7, width: `${40 + ((i * 17) % 50)}%`, background: C.sunk, borderRadius: 4, marginTop: 7 }} />
          </div>
        ))}
      </div>
      <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(246,248,244,0) 35%, ${C.paper} 82%)` }} />
      <div style={{ position: "absolute", left: 120, bottom: 120 }}>
        <Sequence from={sec(1.0) - 4} layout="none"><Caption title={t.title} mark={false} width={1200} size={104} /></Sequence>
      </div>
    </AbsoluteFill>
  );
};

// --- 2. маркер на объявлении ---
const Marks: React.FC<{ lang: Lang }> = ({ lang }) => {
  const f = useCurrentFrame();
  const s = scene("marks");
  const t = s[lang];
  const base = sec(s.start);
  const at = (abs: number) => sec(abs) - base;
  const colors = [C.yes, C.ask, C.no];
  const glyphs = ["✓", "?", "✕"];
  const card = useRise(0);
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 120, top: 300 }}><Caption title={t.title} sub={t.sub} mark={false} width={620} size={80} /></div>
      <div style={{ ...card, position: "absolute", left: 860, top: 170, width: 900, background: C.surface, borderRadius: 22, border: `1.5px solid ${C.line}`,
        padding: "48px 56px", boxShadow: "0 40px 90px -40px rgba(28,34,38,0.25)" }}>
        <div style={{ fontSize: 40, fontWeight: 650, color: C.ink }}>{t.card.title}</div>
        <div style={{ fontSize: 20, color: C.soft, marginTop: 8 }}>{t.card.meta}</div>
        <div style={{ height: 10, width: "88%", background: C.sunk, borderRadius: 5, marginTop: 34 }} />
        <div style={{ height: 10, width: "72%", background: C.sunk, borderRadius: 5, marginTop: 12 }} />
        {t.lines.map((line: string, i: number) => {
          const p = wipe(f, at([5.6, 6.4, 7.2][i]) - 4, 14);
          const n = interpolate(f, [at([5.6, 6.4, 7.2][i]) + 6, at([5.6, 6.4, 7.2][i]) + 14], [0, 1], clamp);
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 30, gap: 24 }}>
              <div style={{ fontSize: 32, color: C.ink, fontWeight: 500 }}><Mark p={p} color={colors[i]} h="0.9em">{line}</Mark></div>
              <div style={{ opacity: n, transform: `translateX(${(1 - n) * 10}px)`, display: "flex", alignItems: "center", gap: 10, fontSize: 21, color: C.ink, whiteSpace: "nowrap" }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: colors[i], display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{glyphs[i]}</span>
                {t.notes[i]}
              </div>
            </div>
          );
        })}
        <div style={{ height: 10, width: "64%", background: C.sunk, borderRadius: 5, marginTop: 34 }} />
        <div style={{ height: 10, width: "80%", background: C.sunk, borderRadius: 5, marginTop: 12 }} />
      </div>
    </AbsoluteFill>
  );
};

// --- 3–5. настоящие записи экрана ---
const Clip: React.FC<{ id: string; lang: Lang }> = ({ id, lang }) => {
  const f = useCurrentFrame();
  const s = scene(id);
  const t = s[lang];
  const len = sec(s.end - s.start);
  const zoom = interpolate(f, [0, len], [1, 1.035]);
  const win = useRise(0);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: 100, top: 330 }}><Caption title={t.title} sub={t.sub} width={520} size={60} /></div>
      <div style={{ position: "absolute", left: 100, bottom: 96 }}><Tag text={t.tag} /></div>
      <div style={{ ...win, position: "absolute", left: 680, top: 128 }}>
        <Window w={1160}>
          <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 30%" }}>
            <OffthreadVideo src={staticFile(s.clip)} trimBefore={sec(s.from)} playbackRate={s.rate} muted style={{ width: "100%", height: "100%" }} />
          </div>
        </Window>
      </div>
    </AbsoluteFill>
  );
};

// --- 6. три вердикта ---
const Verdicts: React.FC<{ lang: Lang }> = ({ lang }) => {
  const f = useCurrentFrame();
  const s = scene("verdicts");
  const t = s[lang];
  const base = sec(s.start);
  const colors = [C.yes, C.ask, C.no];
  const glyphs = ["✓", "?", "✕"];
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: FONT }}>
      <div style={{ position: "absolute", left: 120, top: 150 }}><Caption title={t.title} mark={false} width={1500} size={84} /></div>
      <div style={{ position: "absolute", left: 120, top: 400, display: "grid", gap: 44 }}>
        {t.rows.map((r: string[], i: number) => {
          const at = sec([37.4, 38.2, 39.0][i]) - base;
          const p = wipe(f, at - 4, 14);
          const o = interpolate(f, [at - 6, at + 4], [0, 1], clamp);
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 40, opacity: o }}>
              <div style={{ width: 560, fontSize: 64, fontWeight: 650, color: C.ink, whiteSpace: "nowrap" }}>
                <Mark p={p} color={colors[i]} h="1.05em"><span style={{ fontWeight: 700, marginRight: 18 }}>{glyphs[i]}</span>{r[0]}</Mark>
              </div>
              <div style={{ fontSize: 32, color: C.soft, maxWidth: 1000 }}>{r[1]}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// --- 7. локальная модель ---
const Local: React.FC<{ lang: Lang }> = ({ lang }) => {
  const f = useCurrentFrame();
  const s = scene("local");
  const t = s[lang];
  const len = sec(s.end - s.start);
  const z = interpolate(f, [0, len], [1.42, 1.5]);
  const win = useRise(0);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: 100, top: 330 }}><Caption title={t.title} sub={t.sub} width={560} size={60} /></div>
      <div style={{ ...win, position: "absolute", left: 720, top: 150 }}>
        <Window w={1100}>
          <Img src={staticFile("setup-assistant.png")} style={{ position: "absolute", width: "100%", height: "100%", transform: `scale(${z})`, transformOrigin: "62% 62%" }} />
        </Window>
      </div>
    </AbsoluteFill>
  );
};

// --- 8. отклик — ваш ---
const You: React.FC<{ lang: Lang }> = ({ lang }) => {
  const f = useCurrentFrame();
  const s = scene("you");
  const t = s[lang];
  const len = sec(s.end - s.start);
  const z = interpolate(f, [0, len], [1.0, 1.04]);
  const win = useRise(0);
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: 100, top: 330 }}><Caption title={t.title} sub={t.sub} width={560} size={60} /></div>
      <div style={{ ...win, position: "absolute", left: 720, top: 150 }}>
        <Window w={1100}>
          <Img src={staticFile("results-letter.png")} style={{ position: "absolute", width: "100%", height: "100%", transform: `scale(${z})`, transformOrigin: "50% 40%" }} />
        </Window>
      </div>
    </AbsoluteFill>
  );
};

// --- 9. финал ---
const End: React.FC<{ lang: Lang; still?: boolean }> = ({ lang, still }) => {
  const f = useCurrentFrame();
  const t = scene("end")[lang];
  const icon = useRise(0);
  const a = useRise(8);
  const b = useRise(18);
  const p = still ? 1 : wipe(f, sec(53.7 - 53.0) - 4, 18);
  return (
    <AbsoluteFill style={{ background: C.paper, fontFamily: FONT, alignItems: "flex-start", justifyContent: "center", paddingLeft: 160 }}>
      <Img src={staticFile("icon.svg")} style={{ ...(still ? {} : icon), width: 150, height: 150, marginBottom: 46 }} />
      <div style={{ ...(still ? {} : a), fontSize: 110, fontWeight: 700, letterSpacing: "-0.03em", color: C.ink }}><Mark p={p}>{t.name}</Mark></div>
      <div style={{ ...(still ? {} : b), fontSize: 38, color: C.soft, marginTop: 26 }}>{t.line}</div>
      <div style={{ ...(still ? {} : b), fontSize: 30, color: C.pine, marginTop: 64, fontWeight: 600 }}>{t.url}</div>
    </AbsoluteFill>
  );
};

export const Film: React.FC<{ lang: Lang }> = ({ lang }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Fonts />
    {tl.scenes.map((s) => {
      const len = sec(s.end - s.start);
      const last = s.id === "end";
      const body =
        s.id === "wall" ? <Wall lang={lang} len={len} /> :
        s.id === "marks" ? <Marks lang={lang} /> :
        s.id === "verdicts" ? <Verdicts lang={lang} /> :
        s.id === "local" ? <Local lang={lang} /> :
        s.id === "you" ? <You lang={lang} /> :
        s.id === "end" ? <End lang={lang} /> :
        <Clip id={s.id} lang={lang} />;
      return (
        <Sequence key={s.id} from={sec(s.start)} durationInFrames={len} name={s.id}>
          <SceneFade len={len} out={!last}>{body}</SceneFade>
        </Sequence>
      );
    })}
  </AbsoluteFill>
);

export const Poster: React.FC<{ lang: Lang }> = ({ lang }) => (
  <AbsoluteFill style={{ background: C.paper }}>
    <Fonts />
    <End lang={lang} still />
  </AbsoluteFill>
);

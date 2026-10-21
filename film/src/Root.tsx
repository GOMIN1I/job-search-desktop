import { Composition, Still } from "remotion";
import { Film, Poster } from "./Film";
import tl from "../timeline.json";

export const Root: React.FC = () => (
  <>
    <Composition id="FilmRU" component={Film} defaultProps={{ lang: "ru" as const }}
      durationInFrames={Math.round(tl.duration * tl.fps)} fps={tl.fps} width={tl.width} height={tl.height} />
    <Composition id="FilmEN" component={Film} defaultProps={{ lang: "en" as const }}
      durationInFrames={Math.round(tl.duration * tl.fps)} fps={tl.fps} width={tl.width} height={tl.height} />
    <Still id="PosterRU" component={Poster} defaultProps={{ lang: "ru" as const }} width={tl.width} height={tl.height} />
    <Still id="PosterEN" component={Poster} defaultProps={{ lang: "en" as const }} width={tl.width} height={tl.height} />
  </>
);

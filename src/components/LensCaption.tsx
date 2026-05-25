// Bottom caption strip. Full-width, dark-translucent, light text in
// the 24-32px range per the brief. Cross-fades in sync with the stage.

type Props = {
  text: string;
  fading: boolean;
};

export function LensCaption({ text, fading }: Props) {
  return (
    <div className={`cine-caption ${fading ? 'cine-caption-fading' : ''}`}>
      <div className="cine-caption-inner">{text}</div>
    </div>
  );
}

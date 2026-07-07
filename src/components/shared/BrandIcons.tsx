interface BrandIconProps {
  size?: number;
  className?: string;
}

import ClaudeSvg from '../../assets/claude.svg?url';
import GeminiSvg from '../../assets/gemini.svg?url';
import HermesPng from '../../assets/hermes.png?url';
import OpenAISvg from '../../assets/openai.svg?url';
import OpenClawSvg from '../../assets/openclaw.svg?url';
import OpenCodeSvg from '../../assets/opencode.svg?url';

export function ClaudeBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={ClaudeSvg} width={size} height={size} className={className} alt="Claude" loading="lazy" />;
}

export function CodexBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={OpenAISvg} width={size} height={size} className={`dark:brightness-0 dark:invert ${className}`} alt="Codex" loading="lazy" />;
}

export function AntigravityBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={GeminiSvg} width={size} height={size} className={className} alt="Antigravity CLI" loading="lazy" />;
}

export function OpenCodeBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={OpenCodeSvg} width={size} height={size} className={className} alt="OpenCode" loading="lazy" />;
}

export function OpenClawBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={OpenClawSvg} width={size} height={size} className={className} alt="OpenClaw" loading="lazy" />;
}

export function HermesBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={HermesPng} width={size} height={size} className={className} alt="Hermes Agent" loading="lazy" />;
}

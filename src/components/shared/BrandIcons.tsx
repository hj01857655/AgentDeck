interface BrandIconProps {
  size?: number;
  className?: string;
}

import ClaudeSvg from '../assets/claude.svg?url';
import OpenAISvg from '../assets/openai.svg?url';

export function ClaudeBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={ClaudeSvg} width={size} height={size} className={className} alt="Claude" loading="lazy" />;
}

export function CodexBrandIcon({ size = 16, className = '' }: BrandIconProps) {
  return <img src={OpenAISvg} width={size} height={size} className={`dark:brightness-0 dark:invert ${className}`} alt="Codex" loading="lazy" />;
}

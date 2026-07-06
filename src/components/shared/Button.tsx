import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type' | 'onClick'> {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
  tone?: ButtonTone;
  className?: string;
}

const tones: Record<ButtonTone, string> = {
  primary: 'btn-primary',
  secondary: 'btn-outline',
  danger: 'btn-error',
  ghost: 'btn-ghost',
  success: 'btn-success',
};

export function Button({ children, onClick, disabled, type = 'button', tone = 'secondary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-sm ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  );
}

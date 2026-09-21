import { Checkbox } from '@heroui/react';
import type { ReactNode } from 'react';

/**
 * HeroUI's `Checkbox` (= `Checkbox.Root`) only renders an unstyled accessible field wrapper — the
 * visible box and checkmark are separate composable pieces (`Checkbox.Content` > `Checkbox.Control`
 * > `Checkbox.Indicator`) that have to be nested explicitly, or nothing shows at all. This wraps
 * that composition once so call sites can use it like a normal checkbox.
 */
export default function CheckboxField({
  isSelected,
  onChange,
  children,
  className,
}: {
  isSelected: boolean;
  onChange: (isSelected: boolean) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Checkbox isSelected={isSelected} onChange={onChange} className={className}>
      <Checkbox.Content>
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        {children}
      </Checkbox.Content>
    </Checkbox>
  );
}

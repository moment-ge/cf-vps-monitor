import {
  Children,
  createContext,
  forwardRef,
  isValidElement,
  useContext,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "ghost" | "outline" | "icon";
  size?: "default" | "sm" | "icon";
}>(({ className, variant = "default", size = "default", ...props }, ref) => (
  <button
    ref={ref}
    className={cn("ui-button", `ui-button-${variant}`, `ui-button-${size}`, className)}
    {...props}
  />
));
Button.displayName = "Button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn("ui-input", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn("ui-textarea", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const Checkbox = forwardRef<
  HTMLButtonElement,
  Omit<CheckboxPrimitive.CheckboxProps, "onCheckedChange"> & {
    onCheckedChange?: CheckboxPrimitive.CheckboxProps["onCheckedChange"];
  }
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn("ui-checkbox", className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="ui-checkbox-indicator">
      <Check size={13} strokeWidth={2.5} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

type SelectProps = Pick<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "name" | "disabled" | "required" | "title" | "tabIndex" | "aria-label" | "aria-labelledby" | "aria-describedby"
> & {
  className?: string;
  children?: ReactNode;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: SelectHTMLAttributes<HTMLSelectElement>["onChange"];
};

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  ({ className, value, defaultValue, onChange, children, disabled, ...props }, ref) => {
    const options = Children.toArray(children).filter(isValidElement).map((child) => {
      const option = child as ReactElement<{ value?: string; children?: ReactNode }>;
      const label = option.props.children;
      return {
        key: option.key ?? String(option.props.value ?? label),
        value: String(option.props.value ?? label ?? ""),
        label,
      };
    }).filter((option) => option.value.length > 0);
    const initial = String(value ?? defaultValue ?? options[0]?.value ?? "");
    const [internalValue, setInternalValue] = useState(initial);
    const selected = value === undefined ? internalValue : String(value);
    const active = options.find((option) => option.value === selected);
    return (
      <SelectPrimitive.Root
        value={selected}
        onValueChange={(next) => {
          setInternalValue(next);
          onChange?.({ target: { value: next }, currentTarget: { value: next } } as React.ChangeEvent<HTMLSelectElement>);
        }}
        disabled={disabled}
        name={props.name}
        required={props.required}
      >
        <SelectPrimitive.Trigger
          ref={ref}
          id={props.id}
          title={props.title}
          tabIndex={props.tabIndex}
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          aria-describedby={props["aria-describedby"]}
          className={cn("ui-select-trigger", className)}
        >
          <SelectPrimitive.Value placeholder="请选择">{active?.label}</SelectPrimitive.Value>
          <SelectPrimitive.Icon><ChevronDown size={15} /></SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className="ui-select-content" position="popper" sideOffset={6}>
            <SelectPrimitive.Viewport className="ui-select-viewport">
              {options.map((option) => (
                <SelectPrimitive.Item key={option.key} value={option.value} className="ui-select-item">
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="ui-select-item-indicator"><Check size={14} /></SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    );
  },
);
Select.displayName = "Select";

const TabsContext = createContext<{ value: string; onValueChange: (value: string) => void }>({
  value: "",
  onValueChange: () => undefined,
});

export function Tabs({
  value,
  onValueChange,
  className,
  children,
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={cn("ui-tabs", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, children }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="tablist" className={cn("ui-tabs-list", className)}>
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const tabs = useContext(TabsContext);
  const active = tabs.value === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cn("ui-tabs-trigger", active && "is-active", className)}
      onClick={() => tabs.onValueChange(value)}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-card", className)} {...props} />;
}

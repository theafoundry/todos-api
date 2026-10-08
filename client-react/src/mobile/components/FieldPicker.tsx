import { useId, useState } from "react";

interface FieldPickerOption<T extends string> {
  key: T;
  label: string;
  color?: string;
}

interface FieldPickerProps<T extends string> {
  label: string;
  value: T | null;
  options: FieldPickerOption<T>[];
  onChange: (value: T | null) => void;
  allowClear?: boolean;
  disabled?: boolean;
}

export function FieldPicker<T extends string>({
  label,
  value,
  options,
  onChange,
  allowClear = false,
  disabled = false,
}: FieldPickerProps<T>) {
  const [open, setOpen] = useState(false);
  const optionsId = useId();

  const selectedOption = value ? options.find((o) => o.key === value) : null;

  function handleSelect(key: T) {
    onChange(key);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setOpen(false);
  }

  return (
    <div className={`m-field-picker${open ? " m-field-picker--open" : ""}`}>
      <button
        className="m-field-picker__header"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
        aria-controls={optionsId}
        disabled={disabled}
      >
        <div className="m-sheet-full__field-label">{label}</div>
        <div
          className="m-sheet-full__field-value"
          style={
            selectedOption?.color ? { color: selectedOption.color } : undefined
          }
        >
          {selectedOption ? selectedOption.label : "—"}
          <span className="m-field-picker__chevron">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div
          id={optionsId}
          className="m-field-picker__options"
          role="group"
          aria-label={`${label} options`}
        >
          {options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`m-field-picker__option${value === opt.key ? " m-field-picker__option--active" : ""}`}
              style={opt.color ? { color: opt.color } : undefined}
              onClick={() => handleSelect(opt.key)}
              aria-pressed={value === opt.key}
              disabled={disabled}
            >
              {value === opt.key && (
                <span className="m-field-picker__option-check">✓</span>
              )}
              {opt.label}
            </button>
          ))}
          {allowClear && value !== null && (
            <button
              type="button"
              className="m-field-picker__clear"
              onClick={handleClear}
              disabled={disabled}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

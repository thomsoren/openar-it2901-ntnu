export type TextInputElement = HTMLElement & {
  value: string;
  label: string;
  placeholder: string;
  type: string;
  error: boolean;
  errorText: string;
  helperText: string;
  disabled: boolean;
  required: boolean;
};

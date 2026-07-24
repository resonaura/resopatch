import { useRef, useState } from 'react';
import { Button, Input, Label } from '@heroui/react';
import { ImageOff, Trash2, Upload } from 'lucide-react';
import { fileToCompressedDataUrl } from '../lib/imageUpload';
import { api } from '../api/client';
import { useI18n } from '../lib/i18n';

export default function ImagePicker({
  value,
  onChange,
  label,
}: {
  value: string | undefined;
  onChange: (url: string | undefined) => void;
  label?: string;
}) {
  const { t } = useI18n();
  const displayLabel = label ?? t('imagePicker.label');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const urlValue = value && !value.startsWith('data:') ? value : '';

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file);
      try {
        const res = await api.uploadImage(dataUrl, file.name);
        if (res?.url) {
          onChange(res.url);
          return;
        }
      } catch (err) {
        console.warn('API upload fallback to data URL:', err);
      }
      onChange(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('imagePicker.uploadError'));
    } finally {
      setBusy(false);
    }
  };

  const isStorage = value && !value.startsWith('data:') && !/^https?:\/\//i.test(value);
  const previewSrc = isStorage ? `/img/${value}?w=128` : value;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{displayLabel}</Label>
      <div className="flex items-start gap-2.5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-default-200 bg-surface-secondary">
          {previewSrc ? (
            <img src={previewSrc} alt="" className="h-full w-full object-contain p-0.5 bg-black/20" />
          ) : (
            <ImageOff className="h-4 w-4 text-default-500" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex gap-1.5">
            <Button size="sm" variant="secondary" onPress={() => inputRef.current?.click()} isPending={busy}>
              <Upload className="h-3.5 w-3.5" />
              {t('imagePicker.uploadBtn')}
            </Button>
            {value && (
              <Button size="sm" variant="ghost" isIconOnly onPress={() => onChange(undefined)} aria-label={t('imagePicker.removeBtn')}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <Input
            key={value?.startsWith('data:') ? 'data' : value}
            defaultValue={urlValue}
            placeholder={t('imagePicker.urlPlaceholder')}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== urlValue) onChange(v || undefined);
            }}
          />
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

import { useEffect, useRef } from "react";
import { ObcIconButton } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/components/icon-button/icon-button";
import { IconButtonVariant } from "@ocean-industries-concept-lab/openbridge-webcomponents/dist/components/icon-button/icon-button";
import { ObiCloseGoogle } from "@ocean-industries-concept-lab/openbridge-webcomponents-react/icons/icon-close-google";
import type { MediaLibraryModalProps } from "./types";

export function MediaLibraryModal({
  title,
  labelledBy,
  icon,
  closeLabel,
  onClose,
  children,
  actions,
}: MediaLibraryModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), obc-button, obc-icon-button, obc-text-input-field'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    modalRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="media-library-page__modal-layer" role="presentation">
      <div className="media-library-page__modal-backdrop" onClick={onClose} />
      <div
        ref={modalRef}
        className="media-library-page__modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <div className="media-library-page__modal-header">
          <div className="media-library-page__modal-title-wrap">
            {icon}
            <h2 id={labelledBy} className="media-library-page__modal-title">
              {title}
            </h2>
          </div>
          <ObcIconButton
            className="media-library-page__modal-close"
            variant={IconButtonVariant.flat}
            aria-label={closeLabel}
            onClick={onClose}
          >
            <ObiCloseGoogle />
          </ObcIconButton>
        </div>
        <div className="media-library-page__modal-divider" />
        <div className="media-library-page__modal-content">{children}</div>
        <div className="media-library-page__modal-footer">{actions}</div>
      </div>
    </div>
  );
}

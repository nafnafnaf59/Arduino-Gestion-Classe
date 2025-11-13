import type { FC, ChangeEvent, FormEvent } from "react";
import React, { useCallback, useState } from "react";

export interface CredentialFormValues {
  readonly id: string;
  readonly label: string;
  readonly username: string;
  readonly password: string;
  readonly type: "winrm" | "ssh";
}

export interface CredentialsModalProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (values: CredentialFormValues) => Promise<void>;
}

const DEFAULT_VALUES: CredentialFormValues = {
  id: "",
  label: "",
  username: "",
  password: "",
  type: "winrm"
};

export const CredentialsModal: FC<CredentialsModalProps> = ({ visible, onClose, onSubmit }) => {
  const [values, setValues] = useState<CredentialFormValues>(DEFAULT_VALUES);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const handleChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = event.target;
    setValues((prev) => ({
      ...prev,
      [name]: value
    }));
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!values.id || !values.label) {
        setError("Identifiant et libellé sont obligatoires");
        return;
      }

      try {
        setIsSubmitting(true);
        setError(undefined);
        await onSubmit(values);
        setValues(DEFAULT_VALUES);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [values, onSubmit, onClose]
  );

  if (!visible) {
    return null;
  }

  return (
    <div className="acd-modal-overlay" role="dialog" aria-modal="true">
      <div className="acd-modal">
        <header>
          <h2>Ajouter des identifiants</h2>
        </header>
        <form onSubmit={handleSubmit}>
          <label htmlFor="credential-id">Identifiant</label>
          <input
            id="credential-id"
            name="id"
            type="text"
            className="acd-input"
            value={values.id}
            onChange={handleChange}
            required
          />

          <label htmlFor="credential-label">Libellé</label>
          <input
            id="credential-label"
            name="label"
            type="text"
            className="acd-input"
            value={values.label}
            onChange={handleChange}
            required
          />

          <label htmlFor="credential-type">Type</label>
          <select
            id="credential-type"
            name="type"
            className="acd-select"
            value={values.type}
            onChange={handleChange}
          >
            <option value="winrm">WinRM / PowerShell</option>
            <option value="ssh">SSH</option>
          </select>

          <label htmlFor="credential-username">Nom d'utilisateur</label>
          <input
            id="credential-username"
            name="username"
            type="text"
            className="acd-input"
            value={values.username}
            onChange={handleChange}
            autoComplete="username"
          />

          <label htmlFor="credential-password">Mot de passe / clé</label>
          <input
            id="credential-password"
            name="password"
            type="password"
            className="acd-input"
            value={values.password}
            onChange={handleChange}
            autoComplete="current-password"
          />

          {error && <div className="acd-error">{error}</div>}

          <footer className="acd-modal-footer">
            <button type="button" className="acd-button" onClick={onClose} disabled={isSubmitting}>
              Annuler
            </button>
            <button type="submit" className="acd-button acd-button-primary" disabled={isSubmitting}>
              {isSubmitting ? "Enregistrement…" : "Enregistrer"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

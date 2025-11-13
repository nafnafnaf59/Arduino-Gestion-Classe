import type { FC, ChangeEvent } from "react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { SketchAnalysisResult, SketchOption } from "../../models/types";

export interface SketchSelectorProps {
  readonly defaultSketches: ReadonlyArray<SketchOption>;
  readonly onAnalyze: (sketchPath: string) => Promise<SketchAnalysisResult>;
  readonly onCompile: (sketchPath: string) => Promise<void>;
  readonly onSketchSelected: (sketchPath: string) => void;
  readonly analyzeDisabled?: boolean;
  readonly compileDisabled?: boolean;
}

interface FormState {
  readonly selectedOption: string;
  readonly customPath: string;
}

const DEFAULT_FORM_STATE: FormState = {
  selectedOption: "",
  customPath: ""
};

export const SketchSelector: FC<SketchSelectorProps> = ({
  defaultSketches,
  onAnalyze,
  onCompile,
  onSketchSelected,
  analyzeDisabled,
  compileDisabled
}) => {
  const [formState, setFormState] = useState<FormState>(DEFAULT_FORM_STATE);
  const [analysis, setAnalysis] = useState<SketchAnalysisResult | undefined>();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (formState.selectedOption) {
      const selected = defaultSketches.find((sketch) => sketch.id === formState.selectedOption);
      if (selected) {
        onSketchSelected(selected.path);
      }
    }
  }, [formState.selectedOption, defaultSketches, onSketchSelected]);

  const currentSketchPath = useMemo(() => {
    if (formState.selectedOption === "custom") {
      return formState.customPath.trim();
    }
    const selected = defaultSketches.find((sketch) => sketch.id === formState.selectedOption);
    return selected?.path ?? "";
  }, [formState, defaultSketches]);

  const handleOptionChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const selectedOption = event.target.value;
      setFormState((prev) => ({
        ...prev,
        selectedOption
      }));
      setAnalysis(undefined);
      setError(undefined);
      if (selectedOption !== "custom" && selectedOption.length > 0) {
        const selected = defaultSketches.find((sketch) => sketch.id === selectedOption);
        if (selected) {
          onSketchSelected(selected.path);
        }
      }
    },
    [defaultSketches, onSketchSelected]
  );

  const handleCustomPathChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const customPath = event.target.value;
    setFormState((prev) => ({
      ...prev,
      selectedOption: "custom",
      customPath
    }));
    setAnalysis(undefined);
    setError(undefined);
    onSketchSelected(customPath);
  }, [onSketchSelected]);

  const handleAnalyze = useCallback(async () => {
    const sketchPath = currentSketchPath;
    if (!sketchPath) {
      setError("Veuillez sélectionner un sketch.");
      return;
    }

    try {
      setIsAnalyzing(true);
      setError(undefined);
      const result = await onAnalyze(sketchPath);
      setAnalysis(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAnalyzing(false);
    }
  }, [currentSketchPath, onAnalyze]);

  const handleCompile = useCallback(async () => {
    const sketchPath = currentSketchPath;
    if (!sketchPath) {
      setError("Veuillez sélectionner un sketch.");
      return;
    }

    try {
      setIsCompiling(true);
      setError(undefined);
      await onCompile(sketchPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCompiling(false);
    }
  }, [currentSketchPath, onCompile]);

  return (
    <div className="acd-sketch-selector">
      <h2>Sketch à déployer</h2>
      <label htmlFor="sketch-option">Sketch prédéfini</label>
      <select
        id="sketch-option"
        className="acd-select"
        value={formState.selectedOption}
        onChange={handleOptionChange}
      >
        <option value="">— Choisir —</option>
        {defaultSketches.map((sketch) => (
          <option key={sketch.id} value={sketch.id}>
            {sketch.label}
          </option>
        ))}
        <option value="custom">Chemin personnalisé…</option>
      </select>

      {formState.selectedOption === "custom" && (
        <div className="acd-custom-path">
          <label htmlFor="custom-path">Chemin du sketch</label>
          <input
            id="custom-path"
            type="text"
            className="acd-input"
            placeholder="C:\\Users\\Professeur\\Documents\\Arduino\\MonSketch"
            value={formState.customPath}
            onChange={handleCustomPathChange}
          />
        </div>
      )}

      <div className="acd-actions">
        <button
          type="button"
          className="acd-button"
          onClick={handleAnalyze}
          disabled={isAnalyzing || analyzeDisabled}
        >
          {isAnalyzing ? "Analyse en cours…" : "Analyser le sketch"}
        </button>
        <button
          type="button"
          className="acd-button acd-button-primary"
          onClick={handleCompile}
          disabled={isCompiling || compileDisabled}
        >
          {isCompiling ? "Compilation…" : "Compiler"}
        </button>
      </div>

      {error && <div className="acd-error">{error}</div>}

      {analysis && (
        <div className="acd-analysis-result">
          <h3>Résultat de l’analyse</h3>
          <p>
            <strong>FQBN&nbsp;:</strong> {analysis.metadata.fqbn}
          </p>
          {analysis.metadata.hash && (
            <p>
              <strong>Hash&nbsp;:</strong> {analysis.metadata.hash}
            </p>
          )}
          {analysis.metadata.sizeEstimate && (
            <p>
              <strong>Taille estimée&nbsp;:</strong> {analysis.metadata.sizeEstimate} octets
            </p>
          )}
          {analysis.dependencies.length > 0 && (
            <div>
              <strong>Dépendances&nbsp;:</strong>
              <ul>
                {analysis.dependencies.map((dependency) => (
                  <li key={dependency}>{dependency}</li>
                ))}
              </ul>
            </div>
          )}
          {analysis.missingLibraries.length > 0 && (
            <div className="acd-warning">
              <strong>Bibliothèques manquantes&nbsp;:</strong>
              <ul>
                {analysis.missingLibraries.map((library) => (
                  <li key={library}>{library}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

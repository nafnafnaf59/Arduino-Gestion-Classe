import Ajv, { AnySchema, ErrorObject, ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

export class SchemaValidationError extends Error {
  readonly details: ReadonlyArray<ErrorObject>;

  constructor(message: string, details: ReadonlyArray<ErrorObject>) {
    super(message);
    this.name = "SchemaValidationError";
    this.details = details;
  }
}

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
  useDefaults: true
});

addFormats(ajv);

const validatorCache = new WeakMap<object, ValidateFunction<unknown>>();

export function compileSchema<T>(schema: AnySchema): ValidateFunction<T> {
  const key = schema as unknown as object;
  const cached = validatorCache.get(key);
  if (cached) {
    return cached as ValidateFunction<T>;
  }

  const validator = ajv.compile<T>(schema);
  validatorCache.set(key, validator as ValidateFunction<unknown>);
  return validator;
}

export function assertValid<T>(validator: ValidateFunction<T>, payload: unknown): T {
  if (validator(payload)) {
    // Ajv ne fournit pas de garde de type stricte, on doit donc affirmer manuellement le payload
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
    return payload as T;
  }

  const errors = validator.errors ?? [];
  throw new SchemaValidationError(formatValidationErrors(errors), errors);
}

export function formatValidationErrors(errors: ReadonlyArray<ErrorObject>): string {
  if (!errors.length) {
    return "Schema validation failed (no details)";
  }

  return errors
    .map((error) => {
      const path = error.instancePath || "/";
      const message = error.message ?? "Invalid value";
      return `${path} ${message}`.trim();
    })
    .join("\n");
}

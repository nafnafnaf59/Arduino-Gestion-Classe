declare module "react" {
  export type FC<P = {}> = (props: P & { children?: ReactNode }) => JSX.Element | null;
  export type ReactNode = JSX.Element | string | number | boolean | null | undefined | Iterable<ReactNode>;
  export type BaseSyntheticEvent = {
    bubbles: boolean;
    cancelable: boolean;
    defaultPrevented: boolean;
    eventPhase: number;
    isTrusted: boolean;
    nativeEvent: Event;
    preventDefault(): void;
    stopPropagation(): void;
  };

  export type ChangeEvent<T = Element> = BaseSyntheticEvent & {
    target: T;
    currentTarget: T;
  };

  export type FormEvent<T = Element> = BaseSyntheticEvent & {
    target: T;
    currentTarget: T;
  };
  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prevState: S) => S);
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: () => void | (() => void), deps?: ReadonlyArray<unknown>): void;
  export function useMemo<T>(factory: () => T, deps: ReadonlyArray<unknown>): T;
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, deps: ReadonlyArray<unknown>): T;
  export const Fragment: FC<{ children?: ReactNode }>;

  interface ReactExports {
    Fragment: typeof Fragment;
    useState: typeof useState;
    useEffect: typeof useEffect;
    useMemo: typeof useMemo;
    useCallback: typeof useCallback;
  }

  const React: ReactExports;
  export default React;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}

declare module "react/jsx-runtime" {
  export const jsx: (...args: any[]) => any;
  export const jsxs: (...args: any[]) => any;
  export const Fragment: any;
}

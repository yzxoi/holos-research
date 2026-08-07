/// <reference lib="dom" />
import type { JSX as SolidJSX } from "solid-js";

declare module "*.css";

declare global {
  namespace JSX {
    type Element = SolidJSX.Element;
    interface ElementClass extends SolidJSX.ElementClass {}
    interface ElementAttributesProperty extends SolidJSX.ElementAttributesProperty {}
    interface ElementChildrenAttribute extends SolidJSX.ElementChildrenAttribute {}
    interface IntrinsicElements extends SolidJSX.IntrinsicElements {}
  }
}

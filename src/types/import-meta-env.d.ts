/**
 * Global typing for import.meta.env (Next.js/webpack provides this at build
 * time; tsc needs the shape declared). Used by CU-STRM-05 dev-gated logging.
 */
interface ImportMetaEnv {
    readonly DEV: boolean;
    readonly PROD: boolean;
    readonly MODE: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}

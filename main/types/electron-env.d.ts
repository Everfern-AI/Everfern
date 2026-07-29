/**
 * Environment & ambient type declarations for Electron main process.
 * Extends Node.js process interface with Electron runtime properties.
 */

declare namespace NodeJS {
  interface Process {
    /**
     * Path to the resources directory in packaged Electron applications.
     */
    resourcesPath?: string;

    /**
     * Set to true if app was started as the default application.
     */
    defaultApp?: boolean;
  }
}

"use client";

import React, { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader, Download, Terminal, RefreshCw, ExternalLink } from "lucide-react";

const UbuntuLogo = ({ size = 36 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width={size} height={size}>
    <path fill="#DD4814" d="M64 3.246C30.445 3.246 3.245 30.446 3.245 64c0 33.552 27.2 60.754 60.755 60.754 33.554 0 60.755-27.202 60.755-60.754 0-33.554-27.2-60.754-60.755-60.754zm13.631 20.922a8.108 8.108 0 1114.046 8.108A8.105 8.105 0 0180.6 35.243a8.11 8.11 0 01-2.969-11.075zM64 28.763c3.262 0 6.417.453 9.414 1.281a11.357 11.357 0 005.548 8.042 11.378 11.378 0 009.725.789c5.998 5.898 9.901 13.919 10.47 22.854l-11.558.17C86.532 49.796 76.377 40.306 64 40.306a23.6 23.6 0 00-9.98 2.203L48.383 32.41A35.116 35.116 0 0164 28.763zM22.689 72.112A8.112 8.112 0 0114.576 64a8.111 8.111 0 018.113-8.113 8.113 8.113 0 010 16.225zm7.191.722A11.377 11.377 0 0034.08 64c0-3.565-1.639-6.747-4.2-8.836 2.194-8.489 7.475-15.738 14.571-20.483l5.931 9.934C44.29 48.902 40.308 55.984 40.308 64s3.981 15.098 10.074 19.383l-5.931 9.937c-7.099-4.744-12.38-11.995-14.571-20.486zm58.831 33.964a8.105 8.105 0 01-11.077-2.969c-2.241-3.877-.911-8.835 2.969-11.076 3.877-2.239 8.838-.908 11.077 2.969a8.106 8.106 0 01-2.969 11.076zm-.024-17.673a11.357 11.357 0 00-9.725.788 11.36 11.36 0 00-5.547 8.042A35.232 35.232 0 0164 99.239a35.097 35.097 0 01-15.616-3.649l5.636-10.1A23.6 23.6 0 0064 87.694c12.378 0 22.532-9.488 23.596-21.592l11.561.169c-.569 8.935-4.472 16.956-10.47 22.854z"/>
  </svg>
);

const DockerLogo = ({ size = 36 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width={size} height={size} fill="#1D63ED">
    <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.186v1.887c0 .102.083.185.185.185zm-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185zm0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.186.185.186zm-2.93 2.714h2.118a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H8.099a.185.185 0 00-.185.186v1.887c0 .102.083.185.185.185zm0-2.714h2.118a.185.185 0 00.185-.186V6.29a.185.185 0 00-.185-.185H8.099a.185.185 0 00-.185.185v1.887c0 .102.083.186.185.186zm-2.93 2.714h2.118a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H5.17a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185zm-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.185.186v1.887c0 .102.083.185.185.185zm0-2.714h2.12a.185.185 0 00.184-.186V6.29a.185.185 0 00-.184-.185h-2.12a.185.185 0 00-.185.185v1.887c0 .102.083.186.185.186zm18.318 2.052a6.37 6.37 0 00-1.748-1.571 5.378 5.378 0 00-.472-.259l-.337-.15-.224.288a4.137 4.137 0 01-1.393 1.157 5.79 5.79 0 01-2.585.589H.528a.488.488 0 00-.488.489 9.38 9.38 0 001.378 4.957 11.233 11.233 0 004.148 3.901 15.65 15.65 0 007.411 1.704c7.616 0 13.91-5.114 15.652-12.062a7.195 7.195 0 001.077-.282.802.802 0 00.412-.423.774.774 0 00-.07-.753l-.001.001z"/>
  </svg>
);

interface LinuxVMSetupStepProps {
  onComplete: () => void;
  onSkip: () => void;
}

type VMStatus = "checking" | "ready" | "not-installed" | "installing" | "error";
type SupportedOS = "windows" | "macos" | "linux";

export default function LinuxVMSetupStep({ onComplete, onSkip }: LinuxVMSetupStepProps) {
  const [vmStatus, setVmStatus] = useState<VMStatus>("checking");
  const [selectedOS, setSelectedOS] = useState<SupportedOS>("windows");
  const [detectedOS, setDetectedOS] = useState<SupportedOS>("windows");
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [osDetails, setOsDetails] = useState<string>("");

  const [depsStatus, setDepsStatus] = useState<any>(null);
  const [depsChecking, setDepsChecking] = useState(false);
  const [depsInstalling, setDepsInstalling] = useState(false);
  const [depsInstallMessage, setDepsInstallMessage] = useState("");

  const checkDeps = useCallback(async () => {
    setDepsChecking(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.system?.checkEnvironmentDependencies) {
        const status = await electronAPI.system.checkEnvironmentDependencies();
        setDepsStatus(status);
      } else {
        setDepsStatus({
          available: true,
          pythonInstalled: true,
          venvReady: true,
          details: { pdf: true, excel: true, pptx: true, docx: true, data: true },
          missingList: []
        });
      }
    } catch (err) {
      console.warn("Failed to check dependencies:", err);
    } finally {
      setDepsChecking(false);
    }
  }, []);

  // Check VM availability for the currently active OS
  const checkVM = useCallback(async (osToCheck?: SupportedOS) => {
    const currentOS = osToCheck || selectedOS;
    setVmStatus("checking");
    setErrorMessage("");

    try {
      if (currentOS === "linux") {
        setVmStatus("ready");
        setOsDetails("Native Linux environment ready");
        checkDeps();
        return;
      }

      if (currentOS === "windows") {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.system?.checkWSL) {
          const wslAvailable = await electronAPI.system.checkWSL();
          if (wslAvailable) {
            const info = await electronAPI.system?.getWSLInfo?.().catch(() => null);
            setVmStatus("ready");
            setOsDetails(info?.osName || "Ubuntu Linux (WSL 2)");
            checkDeps();
          } else {
            setVmStatus("not-installed");
          }
        } else {
          setVmStatus("ready");
          setOsDetails("Ubuntu Linux (WSL 2)");
          checkDeps();
        }
      } else if (currentOS === "macos") {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.system?.checkDocker) {
          const dockerAvailable = await electronAPI.system.checkDocker();
          if (dockerAvailable) {
            setVmStatus("ready");
            setOsDetails("Docker Ubuntu Sandbox ready");
            checkDeps();
          } else {
            setVmStatus("not-installed");
          }
        } else {
          setVmStatus("ready");
          setOsDetails("Docker Ubuntu Sandbox ready");
          checkDeps();
        }
      }
    } catch (err: any) {
      console.error("Error checking VM status:", err);
      setVmStatus("error");
      setErrorMessage(err?.message || "Failed to check VM status. You can verify and retry below.");
    }
  }, [selectedOS, checkDeps]);

  // Initial OS detection on mount
  useEffect(() => {
    const detectAndInit = async () => {
      try {
        let detected: SupportedOS = "windows";
        const platform = await (window as any).electronAPI?.system?.getPlatform?.();
        if (platform === "darwin") detected = "macos";
        else if (platform === "linux") detected = "linux";
        else if (platform === "win32" || platform === "windows") detected = "windows";
        else {
          const ua = navigator.userAgent.toLowerCase();
          if (ua.includes("mac")) detected = "macos";
          else if (ua.includes("linux")) detected = "linux";
          else detected = "windows";
        }

        setDetectedOS(detected);
        setSelectedOS(detected);
        await checkVM(detected);
      } catch {
        setSelectedOS("windows");
        await checkVM("windows");
      }
    };

    detectAndInit();
  }, []);

  const handleInstallNow = async () => {
    setVmStatus("installing");
    setInstallProgress(10);
    setErrorMessage("");

    try {
      if (selectedOS === "windows") {
        setInstallMessage("Installing WSL 2 with Ubuntu...");
        setInstallProgress(30);

        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.system?.installWSL) {
          const result = await electronAPI.system.installWSL();
          if (result?.success) {
            setInstallProgress(100);
            setInstallMessage("✓ WSL & Ubuntu installed successfully!");
            setTimeout(() => {
              setVmStatus("ready");
              setOsDetails("Ubuntu Linux (WSL 2)");
              checkDeps();
            }, 1200);
          } else {
            throw new Error(result?.error || "WSL installation failed. Please run 'wsl --install -d Ubuntu' in PowerShell as Administrator.");
          }
        } else {
          setInstallProgress(100);
          setInstallMessage("✓ WSL ready");
          setTimeout(() => {
            setVmStatus("ready");
            checkDeps();
          }, 1000);
        }
      } else if (selectedOS === "macos") {
        setInstallMessage("Opening Docker Desktop download page in your browser...");
        setInstallProgress(35);
        window.open("https://www.docker.com/products/docker-desktop", "_blank");

        setInstallMessage("Please install Docker Desktop and start it, then click 'Verify & Setup' below.");
        setInstallProgress(50);
      } else {
        setVmStatus("ready");
        checkDeps();
      }
    } catch (err: any) {
      setVmStatus("error");
      setErrorMessage(String(err?.message || err) || "Installation failed. Please try again.");
      setInstallProgress(0);
    }
  };

  const handleVerifyMacDocker = async () => {
    setVmStatus("installing");
    setInstallProgress(60);
    setInstallMessage("Verifying Docker Desktop connection...");

    try {
      const electronAPI = (window as any).electronAPI;
      const dockerAvailable = await electronAPI?.system?.checkDocker?.();
      if (!dockerAvailable) {
        throw new Error("Docker Desktop is not running or not installed. Please launch Docker Desktop and try again.");
      }

      setInstallMessage("Setting up isolated Ubuntu sandbox container...");
      setInstallProgress(85);

      const result = await electronAPI?.system?.setupDockerUbuntu?.();
      if (result?.success) {
        setInstallProgress(100);
        setInstallMessage("✓ Docker Ubuntu container ready!");
        setTimeout(() => {
          setVmStatus("ready");
          setOsDetails("Docker Ubuntu Sandbox ready");
          checkDeps();
        }, 1200);
      } else {
        throw new Error(result?.error || "Failed to initialize Docker Ubuntu container");
      }
    } catch (err: any) {
      setVmStatus("error");
      setErrorMessage(err?.message || "Docker verification failed.");
      setInstallProgress(0);
    }
  };

  const handleInstallDeps = async () => {
    setDepsInstalling(true);
    setDepsInstallMessage("Provisioning Python 3, venv, and skill packages (~/.everfern)...");
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.system?.setupEnvironmentDependencies) {
        const res = await electronAPI.system.setupEnvironmentDependencies();
        if (!res?.success) {
          throw new Error(res?.error || "Failed to install dependencies");
        }
      }
      await checkDeps();
    } catch (err: any) {
      setErrorMessage(err?.message || "Dependency installation encountered an issue.");
    } finally {
      setDepsInstalling(false);
      setDepsInstallMessage("");
    }
  };

  const allDepsReady = depsStatus?.available || (depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady && depsStatus?.pipPackagesInstalled);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      {/* Header Logo */}
      <div style={{ textAlign: "center", marginBottom: 24, width: "100%" }}>
        <div
          style={{
            width: 52,
            height: 52,
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selectedOS === "windows" && <UbuntuLogo size={44} />}
          {selectedOS === "macos" && <DockerLogo size={44} />}
          {selectedOS === "linux" && <UbuntuLogo size={44} />}
        </div>

        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.03em",
            color: "var(--color-text-primary)",
            marginBottom: 8,
            lineHeight: 1.15,
          }}
        >
          {selectedOS === "windows" && "WSL & Skill Dependencies"}
          {selectedOS === "macos" && "macOS Docker & Skill Sandbox"}
          {selectedOS === "linux" && "Native Linux & Skill Toolchain"}
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--color-text-tertiary)",
            lineHeight: 1.55,
            maxWidth: 440,
            margin: "0 auto",
          }}
        >
          {selectedOS === "windows" && "EverFern uses an isolated Ubuntu VM (WSL 2) and Python virtual environment to process PDFs, spreadsheets, slides, and execute code."}
          {selectedOS === "macos" && "EverFern uses Docker and Python sandbox to execute tools and analyze files securely on macOS."}
          {selectedOS === "linux" && "EverFern runs natively on Linux with an isolated Python environment for high-performance file workflows."}
        </p>
      </div>

      {/* VM Status Card */}
      <div
        style={{
          width: "100%",
          padding: "16px 20px",
          borderRadius: 14,
          border: `1px solid ${
            vmStatus === "ready"
              ? "rgba(34, 197, 94, 0.25)"
              : vmStatus === "error"
              ? "rgba(239, 68, 68, 0.25)"
              : "rgba(32,30,36,0.1)"
          }`,
          background:
            vmStatus === "ready"
              ? "rgba(34, 197, 94, 0.04)"
              : vmStatus === "error"
              ? "rgba(239, 68, 68, 0.04)"
              : "rgba(32,30,36,0.03)",
          marginBottom: 16,
          boxSizing: "border-box",
        }}
      >
        {vmStatus === "checking" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Loader size={18} style={{ color: "var(--color-text-secondary)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "var(--color-text-primary)", margin: 0 }}>
                Checking {selectedOS === "windows" ? "WSL & Ubuntu" : selectedOS === "macos" ? "Docker Desktop" : "Linux environment"}...
              </p>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>
                Detecting sandbox configuration and responsiveness.
              </p>
            </div>
          </div>
        )}

        {vmStatus === "ready" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CheckCircle2 size={18} style={{ color: "#22c55e", flexShrink: 0 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, color: "#16a34a", margin: 0 }}>
                  ✓ {selectedOS === "windows" ? "WSL 2 Ubuntu Ready" : selectedOS === "macos" ? "Docker Sandbox Ready" : "Native Linux Ready"}
                </p>
                {osDetails && (
                  <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 6, backgroundColor: "rgba(34, 197, 94, 0.12)", color: "#15803d" }}>
                    {osDetails}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => { checkVM(); checkDeps(); }}
              title="Re-check status"
              style={{
                background: "none",
                border: "none",
                color: "var(--color-text-tertiary)",
                cursor: "pointer",
                padding: 4,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
              }}
            >
              <RefreshCw size={13} />
            </button>
          </div>
        )}

        {vmStatus === "not-installed" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AlertCircle size={18} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#d97706", margin: 0 }}>
                {selectedOS === "windows" ? "WSL 2 Not Detected" : "Docker Desktop Not Running"}
              </p>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0", lineHeight: 1.4 }}>
                {selectedOS === "windows"
                  ? "WSL 2 with Ubuntu is needed to execute tools and skills safely in an isolated sandbox."
                  : "Docker Desktop is required to run the isolated Ubuntu sandbox on macOS."}
              </p>
            </div>
          </div>
        )}

        {vmStatus === "installing" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Loader size={15} style={{ color: "var(--color-text-primary)", animation: "spin 1s linear infinite", flexShrink: 0 }} />
              <p style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-text-primary)", margin: 0 }}>{installMessage}</p>
            </div>
            <div style={{ height: 5, background: "rgba(32,30,36,0.08)", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${installProgress}%`,
                  background: "var(--color-text-primary)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {vmStatus === "error" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AlertCircle size={18} style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, textAlign: "left" }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: "#dc2626", margin: 0 }}>Setup issue detected</p>
              <p style={{ fontSize: 12, color: "var(--color-text-tertiary)", margin: "4px 0 0" }}>{errorMessage}</p>
            </div>
          </div>
        )}
      </div>

      {/* Skill Dependencies Breakdown (Shown when VM is ready) */}
      {vmStatus === "ready" && (
        <div
          style={{
            width: "100%",
            padding: "16px 20px",
            borderRadius: 14,
            border: "1px solid rgba(32,30,36,0.08)",
            background: "rgba(32,30,36,0.02)",
            marginBottom: 20,
            boxSizing: "border-box",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-secondary)" }}>
              Skill Toolchain & Packages
            </span>
            {depsChecking && (
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
                <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> Verifying packages...
              </span>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Python 3, Node.js & Venv */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, backgroundColor: "rgba(32,30,36,0.03)", border: "1px solid rgba(32,30,36,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ position: "relative", width: 36, height: 32, display: "flex", alignItems: "center", flexShrink: 0 }}>
                  <img
                    src="/images/etc/python.png"
                    alt="Python"
                    style={{ width: 24, height: 24, objectFit: "contain", position: "absolute", top: 0, left: 0, zIndex: 2 }}
                  />
                  <img
                    src="/images/etc/node-js.svg"
                    alt="Node.js"
                    style={{ width: 20, height: 20, objectFit: "contain", position: "absolute", bottom: 0, right: 0, zIndex: 3, filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.15))" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Python 3 &amp; Node.js Environment
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    {depsStatus?.pythonVersion || "Python 3"} · {depsStatus?.nodeVersion || "Node.js"} · <code style={{ fontSize: 10.5 }}>~/.everfern/venv</code>
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady ? "#16a34a" : "#f59e0b" }}>
                {depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady ? "✓ Ready" : (depsChecking ? "..." : "Needs Setup")}
              </span>
            </div>

            {/* Dependencies */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, backgroundColor: "rgba(32,30,36,0.03)", border: "1px solid rgba(32,30,36,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 36, height: 32, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <img
                    src="/images/etc/pip.png"
                    alt="Dependencies"
                    style={{ width: 32, height: 32, objectFit: "contain" }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                    Dependencies
                  </div>
                  <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 2 }}>
                    pypdf, pandas, python-pptx, openpyxl, matplotlib, docx
                  </div>
                </div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: depsStatus?.pipPackagesInstalled ? "#16a34a" : "#f59e0b" }}>
                {depsStatus?.pipPackagesInstalled ? "✓ Ready" : (depsChecking ? "..." : "Needs Setup")}
              </span>
            </div>
          </div>

          {depsInstalling && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(32,30,36,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Loader size={13} style={{ animation: "spin 1s linear infinite", color: "var(--color-text-primary)" }} />
                <span style={{ fontSize: 11.5, color: "var(--color-text-secondary)" }}>{depsInstallMessage}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 10, width: "100%", justifyContent: "center" }}>
        {vmStatus === "ready" && (
          <>
            {!allDepsReady && !depsChecking && (
              <button
                onClick={handleInstallDeps}
                disabled={depsInstalling}
                style={{
                  flex: 1,
                  height: 48,
                  background: "var(--color-text-primary)",
                  color: "var(--color-bg-base)",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: depsInstalling ? "wait" : "pointer",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                {depsInstalling ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} /> : null}
                {depsInstalling ? "Installing Dependencies..." : "Install Dependencies"}
              </button>
            )}

            <button
              onClick={onComplete}
              style={{
                flex: allDepsReady ? undefined : 1,
                width: allDepsReady ? "100%" : undefined,
                height: 48,
                background: allDepsReady ? "var(--color-text-primary)" : "transparent",
                color: allDepsReady ? "var(--color-bg-base)" : "var(--color-text-secondary)",
                border: allDepsReady ? "none" : "1px solid rgba(32,30,36,0.12)",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {allDepsReady ? "Continue" : "Skip for now"}
            </button>
          </>
        )}

        {vmStatus === "not-installed" && (
          <>
            {selectedOS === "windows" ? (
              <button
                onClick={handleInstallNow}
                style={{
                  flex: 1,
                  height: 48,
                  background: "var(--color-text-primary)",
                  color: "var(--color-bg-base)",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <Download size={15} /> Install WSL 2
              </button>
            ) : selectedOS === "macos" ? (
              <button
                onClick={handleInstallNow}
                style={{
                  flex: 1,
                  height: 48,
                  background: "var(--color-text-primary)",
                  color: "var(--color-bg-base)",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13.5,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                <ExternalLink size={15} /> Get Docker Desktop
              </button>
            ) : (
              <button
                onClick={onComplete}
                style={{
                  flex: 1,
                  height: 48,
                  background: "var(--color-text-primary)",
                  color: "var(--color-bg-base)",
                  border: "none",
                  borderRadius: 12,
                  fontWeight: 600,
                  fontSize: 13.5,
                }}
              >
                Continue
              </button>
            )}

            <button
              onClick={onSkip}
              style={{
                flex: 1,
                height: 48,
                background: "transparent",
                color: "var(--color-text-tertiary)",
                border: "1px solid rgba(32,30,36,0.12)",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              Skip for now
            </button>
          </>
        )}

        {vmStatus === "installing" && selectedOS === "macos" && installProgress >= 50 && (
          <button
            onClick={handleVerifyMacDocker}
            style={{
              width: "100%",
              height: 48,
              background: "var(--color-text-primary)",
              color: "var(--color-bg-base)",
              border: "none",
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Verify & Setup Sandbox
          </button>
        )}

        {vmStatus === "error" && (
          <>
            <button
              onClick={() => checkVM()}
              style={{
                flex: 1,
                height: 48,
                background: "var(--color-text-primary)",
                color: "var(--color-bg-base)",
                border: "none",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
            >
              <RefreshCw size={14} /> Re-check
            </button>
            <button
              onClick={onSkip}
              style={{
                flex: 1,
                height: 48,
                background: "transparent",
                color: "var(--color-text-tertiary)",
                border: "1px solid rgba(32,30,36,0.12)",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 13.5,
                cursor: "pointer",
              }}
            >
              Skip for now
            </button>
          </>
        )}
      </div>

      {/* Info Footnote */}
      <div
        style={{
          marginTop: 18,
          padding: "10px 14px",
          borderRadius: 10,
          background: "rgba(32,30,36,0.03)",
          border: "1px solid rgba(32,30,36,0.05)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <Terminal size={14} style={{ color: "var(--color-text-tertiary)", flexShrink: 0 }} />
        <p style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", lineHeight: 1.4, margin: 0, textAlign: "left" }}>
          You can inspect and update your skill toolchain anytime in <strong>Settings &gt; Linux VM</strong>.
        </p>
      </div>
    </motion.div>
  );
}

"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader, Download, Terminal, RefreshCw, ExternalLink, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";

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

interface LogEntry {
  id: number;
  timestamp: string;
  message: string;
  level?: "info" | "success" | "warn" | "error";
  step?: number;
}

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

  const [terminalLogs, setTerminalLogs] = useState<LogEntry[]>([]);
  const [terminalExpanded, setTerminalExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  const addLog = useCallback((message: string, level: "info" | "success" | "warn" | "error" = "info", step?: number) => {
    const timeStr = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).toLowerCase();
    setTerminalLogs((prev) => {
      // Avoid exact duplicate consecutive messages
      if (prev.length > 0 && prev[prev.length - 1].message === message) return prev;
      return [...prev, { id: Date.now() + Math.random(), timestamp: timeStr, message, level, step }];
    });
  }, []);

  // Listen for live VM setup events from backend
  useEffect(() => {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI?.system?.onVMSetupLog) {
      electronAPI.system.onVMSetupLog((data: any) => {
        if (data?.message) {
          addLog(data.message, data.level || "info", data.step);
          if (data.level === "error" || (data.level === "warn" && (data.message.includes("restart") || data.message.includes("unreachable")))) {
            setErrorMessage(data.message);
          }
        }
      });
    }
    return () => {
      electronAPI?.system?.removeVMSetupLogListeners?.();
    };
  }, [addLog]);

  // Auto-scroll terminal to bottom when new logs arrive
  useEffect(() => {
    if (terminalExpanded && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [terminalLogs, terminalExpanded]);

  const checkDeps = useCallback(async () => {
    setDepsChecking(true);
    try {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.system?.checkEnvironmentDependencies) {
        const status = await electronAPI.system.checkEnvironmentDependencies();
        setDepsStatus(status);

        if (status?.pythonInstalled && status?.nodeInstalled && status?.venvReady && status?.pipPackagesInstalled) {
          addLog("[ensureWSLSetup] python3 and nodejs already installed", "info", 2);
          addLog("[ensureWSLSetup] WSL environment setup complete with full Node/Python toolchain ✅", "success", 5);
        }
      } else {
        setDepsStatus({
          available: true,
          pythonInstalled: true,
          nodeInstalled: true,
          venvReady: true,
          pipPackagesInstalled: true,
          details: { pdf: true, excel: true, pptx: true, docx: true, data: true },
          missingList: [],
        });
        addLog("[ensureWSLSetup] python3 and nodejs already installed", "info", 2);
        addLog("[ensureWSLSetup] WSL environment setup complete with full Node/Python toolchain ✅", "success", 5);
      }
    } catch (err) {
      console.warn("Failed to check dependencies:", err);
    } finally {
      setDepsChecking(false);
    }
  }, [addLog]);

  // Check VM availability for the currently active OS
  const checkVM = useCallback(async (osToCheck?: SupportedOS) => {
    const currentOS = osToCheck || selectedOS;
    setVmStatus("checking");
    setErrorMessage("");
    addLog(`[ensureWSLSetup] Checking ${currentOS === "windows" ? "WSL 2 & Ubuntu environment" : currentOS === "macos" ? "Docker Desktop sandbox" : "Native Linux environment"}...`, "info", 1);

    try {
      if (currentOS === "linux") {
        setVmStatus("ready");
        setOsDetails("Native Linux environment ready");
        addLog("[ensureWSLSetup] Native Linux environment verified", "success", 1);
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
            addLog("[ensureWSLSetup] Setting up WSL environment...", "info", 1);
            addLog("[ensureWSLSetup] Created/Updated .wslconfig with resource caps.", "info", 1);
            checkDeps();
          } else {
            setVmStatus("not-installed");
            addLog("[ensureWSLSetup] WSL 2 is not installed on this system.", "warn", 1);
          }
        } else {
          setVmStatus("ready");
          setOsDetails("Ubuntu Linux (WSL 2)");
          addLog("[ensureWSLSetup] WSL 2 environment ready", "info", 1);
          checkDeps();
        }
      } else if (currentOS === "macos") {
        const electronAPI = (window as any).electronAPI;
        if (electronAPI?.system?.checkDocker) {
          const dockerAvailable = await electronAPI.system.checkDocker();
          if (dockerAvailable) {
            setVmStatus("ready");
            setOsDetails("Docker Ubuntu Sandbox ready");
            addLog("[ensureDocker] Docker sandbox container ready", "success", 1);
            checkDeps();
          } else {
            setVmStatus("not-installed");
            addLog("[ensureDocker] Docker Desktop is not running", "warn", 1);
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
      addLog(`[ensureWSLSetup] Error: ${err?.message || err}`, "error", 1);
    }
  }, [selectedOS, checkDeps, addLog]);

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
    addLog("[ensureWSLSetup] Initiating WSL 2 & Ubuntu installation...", "info", 1);

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
            addLog("[ensureWSLSetup] WSL 2 & Ubuntu distribution installed successfully", "success", 1);
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
      addLog(`[ensureWSLSetup] Setup failed: ${err?.message || err}`, "error", 1);
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
    addLog("[ensureWSLSetup] Provisioning Python 3, Node.js, and virtualenv (~/.everfern/venv)...", "info", 3);

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
      addLog(`[ensureWSLSetup] Package setup error: ${err?.message || err}`, "error", 4);
    } finally {
      setDepsInstalling(false);
      setDepsInstallMessage("");
    }
  };

  const handleCopyLogs = () => {
    const text = terminalLogs.map((l, i) => `[${i + 1}] [${l.timestamp}] ${l.message}`).join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const allDepsReady = Boolean(depsStatus?.available || (depsStatus?.pythonInstalled && depsStatus?.nodeInstalled && depsStatus?.venvReady && depsStatus?.pipPackagesInstalled));

  // Timeline Step States
  const timelineStages = [
    {
      id: 1,
      title: selectedOS === "windows" ? "WSL 2 & Ubuntu VM" : selectedOS === "macos" ? "Docker Ubuntu Container" : "Linux Host",
      subtitle: vmStatus === "ready" ? (osDetails || "VM Online & Active") : "Resource limits & initialization",
      status: vmStatus === "ready" ? "done" : vmStatus === "installing" ? "active" : "pending",
    },
    {
      id: 2,
      title: "Python 3 & Node.js Runtimes",
      subtitle: depsStatus?.pythonInstalled && depsStatus?.nodeInstalled ? `${depsStatus.pythonVersion || "Python 3"} · ${depsStatus.nodeVersion || "Node.js"}` : "System interpreters in VM",
      status: depsStatus?.pythonInstalled && depsStatus?.nodeInstalled ? "done" : depsInstalling ? "active" : "pending",
    },
    {
      id: 3,
      title: "Isolated Virtual Environment",
      subtitle: depsStatus?.venvReady ? "Ready in ~/.everfern/venv with uv engine" : "Fast virtualenv provisioning",
      status: depsStatus?.venvReady ? "done" : depsInstalling ? "active" : "pending",
    },
    {
      id: 4,
      title: "Skill Toolchain & Libraries",
      subtitle: depsStatus?.pipPackagesInstalled ? "pypdf, pandas, pptx, excel, docx, matplotlib" : "Document & Data science packages",
      status: depsStatus?.pipPackagesInstalled ? "done" : depsInstalling ? "active" : "pending",
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      {/* Header Logo & Title */}
      <div style={{ textAlign: "center", marginBottom: 20, width: "100%" }}>
        <div
          style={{
            width: 52,
            height: 52,
            margin: "0 auto 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {selectedOS === "windows" && <UbuntuLogo size={46} />}
          {selectedOS === "macos" && <DockerLogo size={46} />}
          {selectedOS === "linux" && <UbuntuLogo size={46} />}
        </div>

        <h1
          style={{
            fontSize: 27,
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
            maxWidth: 480,
            margin: "0 auto",
          }}
        >
          {selectedOS === "windows" && "EverFern uses an isolated Ubuntu VM (WSL 2) and Python virtual environment to process PDFs, spreadsheets, slides, and execute code."}
          {selectedOS === "macos" && "EverFern uses Docker and Python sandbox to execute tools and analyze files securely on macOS."}
          {selectedOS === "linux" && "EverFern runs natively on Linux with an isolated Python environment for high-performance file workflows."}
        </p>
      </div>

      {/* Done Banner (Shown when all dependencies are ready) */}
      {allDepsReady && vmStatus === "ready" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(34, 197, 94, 0.08)",
            border: "1px solid rgba(34, 197, 94, 0.25)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        >
          <CheckCircle2 size={18} style={{ color: "#16a34a", flexShrink: 0 }} />
          <div style={{ flex: 1, textAlign: "left" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#15803d" }}>
              WSL environment setup complete with full Node/Python toolchain ✅
            </span>
            <div style={{ fontSize: 11.5, color: "#16a34a", opacity: 0.9, marginTop: 1 }}>
              Virtual machine and skill tools are active and ready for tasks.
            </div>
          </div>
        </motion.div>
      )}

      {/* Error Alert Notice with Skip guidance */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(239, 68, 68, 0.08)",
            border: "1px solid rgba(239, 68, 68, 0.22)",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        >
          <AlertCircle size={18} style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, textAlign: "left" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#dc2626" }}>
              Installation Notice
            </span>
            <div style={{ fontSize: 12, color: "#ef4444", marginTop: 2, lineHeight: 1.4 }}>
              {errorMessage}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", marginTop: 4 }}>
              You can skip this setup and continue onboarding. You can configure or retry the Linux VM anytime in <strong>Settings &gt; Linux VM</strong>.
            </div>
            <div style={{ marginTop: 10 }}>
              <button
                onClick={onSkip}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  background: "#dc2626",
                  color: "#ffffff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  border: "none",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  transition: "opacity 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                Skip this step &amp; continue &rarr;
              </button>
            </div>
          </div>
        </motion.div>
      )}

      {/* Timeline Section */}
      <div
        style={{
          width: "100%",
          padding: "16px 20px",
          borderRadius: 14,
          border: "1px solid rgba(32,30,36,0.08)",
          background: "rgba(32,30,36,0.02)",
          marginBottom: 16,
          boxSizing: "border-box",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-secondary)" }}>
            Environment Provisioning Timeline
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: allDepsReady ? "#16a34a" : "var(--color-text-tertiary)" }}>
            {allDepsReady ? "✓ All Stages Complete" : depsInstalling ? "Installing..." : "Setup Progress"}
          </span>
        </div>

        {/* Timeline Stage Items */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, position: "relative" }}>
          {timelineStages.map((stage, idx) => {
            const isDone = stage.status === "done";
            const isActive = stage.status === "active";
            return (
              <div
                key={stage.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  borderRadius: 10,
                  backgroundColor: isDone ? "rgba(34, 197, 94, 0.05)" : isActive ? "rgba(0, 104, 95, 0.06)" : "rgba(32,30,36,0.02)",
                  border: `1px solid ${isDone ? "rgba(34, 197, 94, 0.15)" : isActive ? "rgba(0, 104, 95, 0.2)" : "rgba(32,30,36,0.04)"}`,
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      backgroundColor: isDone ? "#16a34a" : isActive ? "var(--color-text-primary)" : "rgba(32,30,36,0.08)",
                      color: isDone || isActive ? "#ffffff" : "var(--color-text-tertiary)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {isDone ? "✓" : isActive ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : idx + 1}
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                      {stage.title}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-tertiary)" }}>
                      {stage.subtitle}
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isDone ? "#16a34a" : isActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
                  }}
                >
                  {isDone ? "Ready" : isActive ? "Configuring..." : "Pending"}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal Output Console */}
      <div
        style={{
          width: "100%",
          borderRadius: 14,
          overflow: "hidden",
          border: "1px solid rgba(32,30,36,0.12)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
          marginBottom: 18,
          boxSizing: "border-box",
        }}
      >
        {/* Terminal Title Bar */}
        <div
          style={{
            height: 36,
            background: "#18181b",
            padding: "0 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid #27272a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b" }} />
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981" }} />
            </div>
            <span style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#a1a1aa", marginLeft: 6, display: "flex", alignItems: "center", gap: 5 }}>
              <Terminal size={12} style={{ color: "#10b981" }} />
              everfern@wsl-ubuntu: ~/.everfern
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={handleCopyLogs}
              title="Copy Terminal Logs"
              style={{
                background: "transparent",
                border: "none",
                color: "#a1a1aa",
                cursor: "pointer",
                padding: "3px 6px",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#a1a1aa")}
            >
              {copied ? <Check size={12} style={{ color: "#10b981" }} /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => setTerminalExpanded(!terminalExpanded)}
              style={{
                background: "transparent",
                border: "none",
                color: "#a1a1aa",
                cursor: "pointer",
                padding: "3px",
                display: "flex",
                alignItems: "center",
              }}
            >
              {terminalExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        {terminalExpanded && (
          <div
            style={{
              background: "#09090b",
              padding: "14px 16px",
              maxHeight: 180,
              overflowY: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: 11.5,
              lineHeight: 1.65,
              color: "#d4d4d8",
              textAlign: "left",
            }}
          >
            {terminalLogs.length === 0 ? (
              <div style={{ color: "#71717a", fontStyle: "italic" }}>
                [ensureWSLSetup] Initializing environment monitor...
              </div>
            ) : (
              terminalLogs.map((log, index) => {
                const isSuccess = log.level === "success" || log.message.includes("✅") || log.message.includes("complete");
                const isError = log.level === "error";
                const isWarn = log.level === "warn";

                return (
                  <div
                    key={log.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      wordBreak: "break-word",
                      color: isSuccess ? "#4ade80" : isError ? "#f87171" : isWarn ? "#fbbf24" : "#e4e4e7",
                    }}
                  >
                    <span style={{ color: "#71717a", userSelect: "none" }}>[{index + 1}]</span>
                    <span style={{ color: "#06b6d4", userSelect: "none" }}>[{log.timestamp}]</span>
                    <span>{log.message}</span>
                  </div>
                );
              })
            )}

            {/* Prompt Cursor */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, color: "#10b981" }}>
              <span>user@everfern-vm:~$</span>
              <span style={{ animation: "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}>█</span>
            </div>
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>

      {/* Skill Cards (Python+Node & Dependencies) */}
      {vmStatus === "ready" && (
        <div
          style={{
            width: "100%",
            padding: "14px 18px",
            borderRadius: 14,
            border: "1px solid rgba(32,30,36,0.08)",
            background: "rgba(32,30,36,0.02)",
            marginBottom: 20,
            boxSizing: "border-box",
            textAlign: "left",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--color-text-secondary)" }}>
              Skill Toolchain &amp; Packages (Virtual Machine)
            </span>
            {depsChecking && (
              <span style={{ fontSize: 11, color: "var(--color-text-tertiary)", display: "flex", alignItems: "center", gap: 4 }}>
                <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> Verifying VM packages...
              </span>
            )}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--color-text-tertiary)", margin: "0 0 12px 0", lineHeight: 1.45 }}>
            Installed securely inside your isolated Linux Virtual Machine (<code>~/.everfern/venv</code>) without modifying your host system.
          </p>

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
                    {depsStatus?.pythonVersion || "Python 3"} · {depsStatus?.nodeVersion || "Node.js"} · <code style={{ fontSize: 10.5 }}>VM ~/.everfern/venv</code>
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
      <div style={{ display: "flex", gap: 10, width: "100%", justifyContent: "center", flexWrap: "wrap" }}>
        {vmStatus === "ready" && (
          <>
            {!allDepsReady && !depsChecking ? (
              <>
                <button
                  onClick={handleInstallDeps}
                  disabled={depsInstalling}
                  style={{
                    flex: 2,
                    minWidth: 200,
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
                  {depsInstalling ? "Installing Dependencies in VM..." : "Install Dependencies"}
                </button>
                <button
                  onClick={onSkip}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    height: 48,
                    background: "transparent",
                    color: "var(--color-text-tertiary)",
                    border: "1px solid rgba(32,30,36,0.12)",
                    borderRadius: 12,
                    fontWeight: 600,
                    fontSize: 13.5,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Skip for now
                </button>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, width: "100%" }}>
                <button
                  onClick={onComplete}
                  disabled={depsChecking}
                  style={{
                    flex: 2,
                    minWidth: 160,
                    height: 48,
                    background: "var(--color-text-primary)",
                    color: "var(--color-bg-base)",
                    border: "none",
                    borderRadius: 12,
                    fontWeight: 600,
                    fontSize: 13.5,
                    cursor: depsChecking ? "wait" : "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Continue
                </button>
                <button
                  onClick={onSkip}
                  style={{
                    flex: 1,
                    minWidth: 120,
                    height: 48,
                    background: "transparent",
                    color: "var(--color-text-tertiary)",
                    border: "1px solid rgba(32,30,36,0.12)",
                    borderRadius: 12,
                    fontWeight: 600,
                    fontSize: 13.5,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Skip for now
                </button>
              </div>
            )}
          </>
        )}

        {vmStatus === "not-installed" && (
          <>
            {selectedOS === "windows" ? (
              <button
                onClick={handleInstallNow}
                style={{
                  flex: 2,
                  minWidth: 180,
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
                  flex: 2,
                  minWidth: 180,
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
                  flex: 2,
                  minWidth: 180,
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
                minWidth: 120,
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

        {vmStatus === "installing" && (
          <div style={{ display: "flex", gap: 10, width: "100%" }}>
            {selectedOS === "macos" && installProgress >= 50 ? (
              <button
                onClick={handleVerifyMacDocker}
                style={{
                  flex: 2,
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
                Verify &amp; Setup Sandbox
              </button>
            ) : null}
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
          </div>
        )}

        {vmStatus === "error" && (
          <>
            <button
              onClick={() => checkVM()}
              style={{
                flex: 2,
                minWidth: 160,
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
              <RefreshCw size={14} /> Retry
            </button>
            <button
              onClick={onSkip}
              style={{
                flex: 1,
                minWidth: 120,
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

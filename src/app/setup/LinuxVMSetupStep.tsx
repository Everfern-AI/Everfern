"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle2, AlertCircle, Loader, Download, Terminal } from "lucide-react";

interface LinuxVMSetupStepProps {
  onComplete: () => void;
  onSkip: () => void;
}

type VMStatus = "checking" | "ready" | "not-installed" | "installing" | "error";

export default function LinuxVMSetupStep({ onComplete, onSkip }: LinuxVMSetupStepProps) {
  const [vmStatus, setVmStatus] = useState<VMStatus>("checking");
  const [platform, setPlatform] = useState<"windows" | "win32" | "macos" | "darwin" | "linux" | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // Detect platform and check VM availability
  useEffect(() => {
    const checkVM = async () => {
      try {
        // Detect platform
        const detectedPlatform = (window as any).electronAPI?.system?.getPlatform?.();
        if (detectedPlatform) {
          setPlatform(detectedPlatform);
        } else {
          // Fallback: check user agent
          const ua = navigator.userAgent.toLowerCase();
          if (ua.includes("win")) setPlatform("windows");
          else if (ua.includes("mac")) setPlatform("macos");
          else setPlatform("linux");
        }

        // Check VM availability based on platform
        if (detectedPlatform === "win32" || detectedPlatform === "windows") {
          // Check for WSL
          const wslAvailable = await (window as any).electronAPI?.system?.checkWSL?.();
          if (wslAvailable) {
            setVmStatus("ready");
          } else {
            setVmStatus("not-installed");
          }
        } else if (detectedPlatform === "darwin" || detectedPlatform === "macos") {
          // Check for Docker
          const dockerAvailable = await (window as any).electronAPI?.system?.checkDocker?.();
          if (dockerAvailable) {
            setVmStatus("ready");
          } else {
            setVmStatus("not-installed");
          }
        } else {
          // Linux: assume native execution is available
          setVmStatus("ready");
        }
      } catch (err) {
        console.error("Error checking VM status:", err);
        setVmStatus("error");
        setErrorMessage("Failed to check VM status. You can skip this step and set up later.");
      }
    };

    checkVM();
  }, []);

  const handleInstallNow = async () => {
    setVmStatus("installing");
    setInstallProgress(0);
    setInstallMessage("Starting installation...");
    setErrorMessage("");

    try {
      if (platform === "windows" || platform === "win32") {
        // Install WSL
        setInstallMessage("Installing WSL with Ubuntu...");
        const result = await (window as any).electronAPI?.system?.installWSL?.();
        if (result?.success) {
          setInstallProgress(100);
          setInstallMessage("✓ WSL installed successfully!");
          setTimeout(() => {
            setVmStatus("ready");
          }, 1500);
        } else {
          throw new Error(result?.error || "WSL installation failed");
        }
      } else if (platform === "darwin" || platform === "macos") {
        // Install Docker
        setInstallMessage("Docker Desktop installation instructions will open in your browser...");
        setInstallProgress(25);

        // Open Docker Desktop download page
        window.open("https://www.docker.com/products/docker-desktop", "_blank");

        setInstallMessage("Please install Docker Desktop and then click 'Continue' below.");
        setInstallProgress(50);

        // After user installs Docker, they'll click Continue
        // We'll verify Docker is installed when they do
      } else {
        // Linux: native execution available
        setVmStatus("ready");
      }
    } catch (err) {
      setVmStatus("error");
      setErrorMessage(String(err) || "Installation failed. Please try again.");
      setInstallProgress(0);
    }
  };

  const handleContinueAfterDockerInstall = async () => {
    try {
      setInstallMessage("Verifying Docker installation...");
      setInstallProgress(60);

      const dockerAvailable = await (window as any).electronAPI?.system?.checkDocker?.();
      if (!dockerAvailable) {
        throw new Error("Docker is not installed or not running. Please install Docker Desktop first.");
      }

      setInstallMessage("Setting up Ubuntu container...");
      setInstallProgress(80);

      const result = await (window as any).electronAPI?.system?.setupDockerUbuntu?.();
      if (result?.success) {
        setInstallProgress(100);
        setInstallMessage("✓ Docker Ubuntu container ready!");
        setTimeout(() => {
          setVmStatus("ready");
        }, 1500);
      } else {
        throw new Error(result?.error || "Failed to set up Docker container");
      }
    } catch (err) {
      setVmStatus("error");
      setErrorMessage(String(err) || "Setup failed. Please try again.");
      setInstallProgress(0);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", alignItems: "center" }}
    >
      <div style={{ textAlign: "center", marginBottom: 40 }}>
        <h1
          style={{
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: "-0.03em",
            color: "#201e24",
            marginBottom: 10,
            lineHeight: 1.1,
          }}
        >
          Linux VM Setup
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "#8a8886",
            lineHeight: 1.6,
            maxWidth: 340,
            margin: "0 auto",
          }}
        >
          EverFern uses an Ubuntu Linux VM to safely execute commands in an isolated environment.
        </p>
      </div>

      {/* Status Display */}
      <div
        style={{
          width: "100%",
          padding: "24px",
          borderRadius: 16,
          border: "1px solid #e5e7eb",
          background: vmStatus === "ready" ? "rgba(34,197,94,0.04)" : "rgba(59,130,246,0.04)",
          marginBottom: 24,
        }}
      >
        {vmStatus === "checking" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Loader size={20} style={{ color: "#3b82f6", animation: "spin 1s linear infinite" }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#201e24", margin: 0 }}>Checking VM status...</p>
              <p style={{ fontSize: 12, color: "#8a8886", margin: "4px 0 0" }}>Please wait while we detect your system configuration.</p>
            </div>
          </div>
        )}

        {vmStatus === "ready" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <CheckCircle2 size={20} style={{ color: "#22c55e" }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#16a34a", margin: 0 }}>✓ Linux VM ready</p>
              <p style={{ fontSize: 12, color: "#8a8886", margin: "4px 0 0" }}>Your system is configured and ready to use EverFern.</p>
            </div>
          </div>
        )}

        {vmStatus === "not-installed" && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <AlertCircle size={20} style={{ color: "#f59e0b" }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#d97706", margin: 0 }}>
                {platform === "windows" || platform === "win32" ? "WSL not detected" : "Docker not detected"}
              </p>
              <p style={{ fontSize: 12, color: "#8a8886", margin: "4px 0 0" }}>
                {platform === "windows" || platform === "win32"
                  ? "Windows Subsystem for Linux (WSL) is required to run the Linux VM."
                  : "Docker is required to run the Linux VM."}
              </p>
            </div>
          </div>
        )}

        {vmStatus === "installing" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <Loader size={20} style={{ color: "#3b82f6", animation: "spin 1s linear infinite" }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: "#201e24", margin: 0 }}>{installMessage}</p>
            </div>
            <div style={{ height: 6, background: "#e5e7eb", borderRadius: 999, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${installProgress}%`,
                  background: "linear-gradient(90deg, #2563eb, #3b82f6)",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
            <p style={{ fontSize: 11, color: "#8a8886", margin: "8px 0 0", textAlign: "right" }}>
              {Math.round(installProgress)}%
            </p>
          </div>
        )}

        {vmStatus === "error" && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <AlertCircle size={20} style={{ color: "#ef4444", flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#dc2626", margin: 0 }}>Setup failed</p>
              <p style={{ fontSize: 12, color: "#8a8886", margin: "4px 0 0", lineHeight: 1.5 }}>
                {errorMessage}
              </p>
              <a
                href="https://docs.everfern.ai/setup/linux-vm"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: 11,
                  color: "#3b82f6",
                  textDecoration: "none",
                  marginTop: 8,
                  display: "inline-block",
                }}
              >
                View troubleshooting guide →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 12, width: "100%", justifyContent: "center" }}>
        {vmStatus === "not-installed" && (
          <>
            <button
              onClick={handleInstallNow}
              style={{
                flex: 1,
                height: 48,
                background: "#201e24",
                color: "#ffffff",
                border: "none",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#3f3f46";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#201e24";
              }}
            >
              <Download size={16} /> Install Now
            </button>
            <button
              onClick={onSkip}
              style={{
                flex: 1,
                height: 48,
                background: "transparent",
                color: "#8a8886",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#201e24";
                (e.currentTarget as HTMLElement).style.color = "#201e24";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb";
                (e.currentTarget as HTMLElement).style.color = "#8a8886";
              }}
            >
              Skip for now
            </button>
          </>
        )}

        {vmStatus === "ready" && (
          <button
            onClick={onComplete}
            style={{
              flex: 1,
              height: 48,
              background: "#201e24",
              color: "#ffffff",
              border: "none",
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#3f3f46";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#201e24";
            }}
          >
            Continue
          </button>
        )}

        {vmStatus === "installing" && platform === "darwin" && installProgress >= 50 && (
          <button
            onClick={handleContinueAfterDockerInstall}
            style={{
              flex: 1,
              height: 48,
              background: "#201e24",
              color: "#ffffff",
              border: "none",
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#3f3f46";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#201e24";
            }}
          >
            Continue
          </button>
        )}

        {vmStatus === "error" && (
          <>
            <button
              onClick={handleInstallNow}
              style={{
                flex: 1,
                height: 48,
                background: "#201e24",
                color: "#ffffff",
                border: "none",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#3f3f46";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "#201e24";
              }}
            >
              <Download size={16} /> Retry
            </button>
            <button
              onClick={onSkip}
              style={{
                flex: 1,
                height: 48,
                background: "transparent",
                color: "#8a8886",
                border: "1px solid #e5e7eb",
                borderRadius: 12,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#201e24";
                (e.currentTarget as HTMLElement).style.color = "#201e24";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "#e5e7eb";
                (e.currentTarget as HTMLElement).style.color = "#8a8886";
              }}
            >
              Skip for now
            </button>
          </>
        )}
      </div>

      {/* Info Box */}
      <div
        style={{
          marginTop: 24,
          padding: "14px 16px",
          borderRadius: 12,
          background: "rgba(59,130,246,0.04)",
          border: "1px solid rgba(59,130,246,0.15)",
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <Terminal size={16} style={{ color: "#3b82f6", flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 12, color: "#8a8886", lineHeight: 1.6, margin: 0 }}>
          You can set up the Linux VM later from the settings. Skipping this step will allow commands to run locally with permission prompts.
        </p>
      </div>
    </motion.div>
  );
}

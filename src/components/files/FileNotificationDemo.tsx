"use client";

import React, { useState } from "react";
import { SimpleFileNotification } from "./SimpleFileNotification";

export const FileNotificationDemo: React.FC = () => {
    const [demoStatus, setDemoStatus] = useState<'creating' | 'success' | 'error'>('success');

    const sampleFiles = [
        {
            filename: "components/Button.tsx",
            content: `import React from 'react';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  variant = 'primary',
  disabled = false
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={\`px-4 py-2 rounded-lg font-medium transition-colors \${
        variant === 'primary'
          ? 'bg-blue-600 text-white hover:bg-blue-700'
          : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
      } \${disabled ? 'opacity-50 cursor-not-allowed' : ''}\`}
    >
      {children}
    </button>
  );
};`,
            isNew: true
        },
        {
            filename: "utils/helpers.js",
            content: `export const formatDate = (date) => {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(date));
};

export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};`,
            isNew: false
        },
        {
            filename: "styles/globals.css",
            content: `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    font-family: 'Inter', system-ui, sans-serif;
  }
}

@layer components {
  .btn-primary {
    @apply px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors;
  }

  .card {
    @apply bg-white rounded-xl shadow-sm border border-gray-200 p-6;
  }
}`,
            isNew: true
        },
        {
            filename: "package.json",
            content: `{
  "name": "my-app",
  "version": "1.0.0",
  "description": "A modern web application",
  "main": "index.js",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .js,.jsx,.ts,.tsx"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "next": "^13.4.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "eslint": "^8.42.0",
    "typescript": "^5.1.0"
  }
}`,
            isNew: false
        }
    ];

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Enhanced File Notification UI</h2>
                <p className="text-gray-600">Improved design with better spacing, colors, and animations</p>

                {/* Status Toggle */}
                <div className="flex items-center justify-center gap-2 mt-4">
                    <span className="text-sm text-gray-600">Status:</span>
                    <select
                        value={demoStatus}
                        onChange={(e) => setDemoStatus(e.target.value as any)}
                        className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                    >
                        <option value="creating">Creating</option>
                        <option value="success">Success</option>
                        <option value="error">Error</option>
                    </select>
                </div>
            </div>

            {/* Demo Notifications */}
            <div className="space-y-4">
                {sampleFiles.map((file, index) => (
                    <SimpleFileNotification
                        key={index}
                        filename={file.filename}
                        content={file.content}
                        size={file.content.length}
                        isNew={file.isNew}
                        status={demoStatus}
                        onViewFile={() => console.log('View file:', file.filename)}
                        onCopyContent={() => console.log('Copy content:', file.filename)}
                        onOpenInEditor={() => console.log('Open in editor:', file.filename)}
                    />
                ))}
            </div>

            {/* Features List */}
            <div className="mt-12 p-6 bg-gray-50 rounded-xl">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">✨ Enhanced Features</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                        File type color coding
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                        Smooth animations & transitions
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                        Enhanced hover effects
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-orange-500 rounded-full"></span>
                        Better visual hierarchy
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-pink-500 rounded-full"></span>
                        Status-based styling
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-indigo-500 rounded-full"></span>
                        Improved button interactions
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                        Enhanced copy feedback
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                        Better spacing & layout
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FileNotificationDemo;

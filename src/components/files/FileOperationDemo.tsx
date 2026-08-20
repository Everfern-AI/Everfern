"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { FileOperationCard } from "./FileOperationCard";
import { FileCreationNotification } from "./FileCreationNotification";
import { FileWritingProgress } from "./FileWritingProgress";

export const FileOperationDemo: React.FC = () => {
    const [demoStep, setDemoStep] = useState(0);
    const [progress, setProgress] = useState(0);

    const sampleCode = `import React from 'react';
import { useState } from 'react';

interface CustomerDashboardProps {
  customerId: string;
  onUpdate?: (data: any) => void;
}

export const CustomerDashboard: React.FC<CustomerDashboardProps> = ({
  customerId,
  onUpdate
}) => {
  const [loading, setLoading] = useState(false);
  const [customerData, setCustomerData] = useState(null);

  const handleRefresh = async () => {
    setLoading(true);
    try {
      const response = await fetch(\`/api/customers/\${customerId}\`);
      const data = await response.json();
      setCustomerData(data);
      onUpdate?.(data);
    } catch (error) {
      console.error('Failed to fetch customer data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="customer-dashboard">
      <h2>Customer Dashboard</h2>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {/* Customer data display */}
          <pre>{JSON.stringify(customerData, null, 2)}</pre>
          <button onClick={handleRefresh}>Refresh</button>
        </div>
      )}
    </div>
  );
};

export default CustomerDashboard;`;

    const demos = [
        {
            title: "File Creation Progress",
            component: (
                <FileWritingProgress
                    filename="customer_dashboard.tsx"
                    progress={progress}
                    status={progress < 100 ? 'writing' : 'success'}
                    currentStep={progress < 30 ? 'Analyzing requirements' : progress < 60 ? 'Generating code' : progress < 90 ? 'Writing file' : 'Validating syntax'}
                    estimatedSize={sampleCode.length}
                    writtenBytes={Math.floor((progress / 100) * sampleCode.length)}
                />
            )
        },
        {
            title: "File Creation Notification",
            component: (
                <FileCreationNotification
                    filename="customer_dashboard.tsx"
                    content={sampleCode}
                    size={sampleCode.length}
                    isNew={true}
                    status="success"
                    duration={2340}
                    onViewFile={() => console.log('View file')}
                    onOpenInEditor={() => console.log('Open in editor')}
                />
            )
        },
        {
            title: "File Operation Card - Create",
            component: (
                <FileOperationCard
                    operation="create"
                    filename="customer_dashboard.tsx"
                    content={sampleCode}
                    status="success"
                    duration={2340}
                    size={sampleCode.length}
                    onViewFile={() => console.log('View file')}
                    onOpenInEditor={() => console.log('Open in editor')}
                />
            )
        },
        {
            title: "File Operation Card - Edit",
            component: (
                <FileOperationCard
                    operation="edit"
                    filename="customer_dashboard.tsx"
                    content={sampleCode}
                    oldContent={sampleCode.substring(0, sampleCode.length - 200) + "// Old version"}
                    status="success"
                    duration={1850}
                    size={sampleCode.length}
                    onViewFile={() => console.log('View file')}
                    onOpenInEditor={() => console.log('Open in editor')}
                />
            )
        },
        {
            title: "File Operation Card - Error",
            component: (
                <FileOperationCard
                    operation="create"
                    filename="invalid_file.tsx"
                    content=""
                    status="error"
                    error="Permission denied: Cannot write to protected directory"
                    onRetry={() => console.log('Retry operation')}
                />
            )
        }
    ];

    React.useEffect(() => {
        if (demoStep === 0) {
            const interval = setInterval(() => {
                setProgress(prev => {
                    if (prev >= 100) {
                        clearInterval(interval);
                        return 100;
                    }
                    return prev + 2;
                });
            }, 50);
            return () => clearInterval(interval);
        }
    }, [demoStep]);

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
            <div className="text-center mb-8">
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    Enhanced File Writing UI Demo
                </h1>
                <p className="text-gray-600">
                    Better visual feedback for file operations with progress indicators, notifications, and interactive previews
                </p>
            </div>

            {/* Demo Navigation */}
            <div className="flex flex-wrap gap-2 justify-center mb-8">
                {demos.map((demo, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            setDemoStep(index);
                            if (index === 0) setProgress(0);
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            demoStep === index
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                    >
                        {demo.title}
                    </button>
                ))}
            </div>

            {/* Demo Content */}
            <motion.div
                key={demoStep}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="space-y-4"
            >
                <h2 className="text-lg font-semibold text-gray-800 text-center">
                    {demos[demoStep].title}
                </h2>
                {demos[demoStep].component}
            </motion.div>

            {/* Features List */}
            <div className="mt-12 p-6 bg-gray-50 rounded-xl">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Key Features</h3>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-gray-600">
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Real-time progress indicators</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Interactive file previews</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>One-click copy to clipboard</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>File size and line count display</span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Success/error state management</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Operation type indicators</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Duration tracking</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Expandable details view</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FileOperationDemo;

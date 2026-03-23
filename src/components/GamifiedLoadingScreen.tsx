/**
 * Gamified Loading Screen
 * 
 * Beautiful loading experience while models download to browser cache
 */

import { useEffect, useState } from 'react';

interface LoadingScreenProps {
  onComplete: () => void;
}

interface ModelStatus {
  name: string;
  status: 'pending' | 'downloading' | 'ready';
  progress: number;
  size: string;
  icon: string;
}

export function GamifiedLoadingScreen({ onComplete }: LoadingScreenProps) {
  const [models, setModels] = useState<ModelStatus[]>([
    { name: 'Embedding Model', status: 'pending', progress: 0, size: '23 MB', icon: '🧠' },
    { name: 'Language Model', status: 'pending', progress: 0, size: '250 MB', icon: '💬' },
    { name: 'Speech Recognition', status: 'pending', progress: 0, size: '100 MB', icon: '🎤' },
  ]);
  
  const [overallProgress, setOverallProgress] = useState(0);
  const [currentPhase, setCurrentPhase] = useState('Initializing');
  const [funFacts] = useState([
    '💡 All models run 100% in your browser',
    '🔒 Your data never leaves your device',
    '⚡ WebGPU makes inference 10x faster',
    '🌐 Works completely offline after this',
    '🎯 Zero API keys required',
    '🚀 Models cached for instant future loads',
  ]);
  const [currentFactIndex, setCurrentFactIndex] = useState(0);

  useEffect(() => {
    // Rotate fun facts
    const factInterval = setInterval(() => {
      setCurrentFactIndex((prev) => (prev + 1) % funFacts.length);
    }, 3000);

    // Simulate model downloads (in real app, this comes from actual progress)
    const simulateProgress = async () => {
      // Phase 1: Embeddings
      setCurrentPhase('Downloading Embedding Model');
      await updateModelProgress(0, 100);
      
      // Phase 2: LLM
      setCurrentPhase('Downloading Language Model');
      await updateModelProgress(1, 100);
      
      // Phase 3: STT
      setCurrentPhase('Downloading Speech Recognition');
      await updateModelProgress(2, 100);
      
      setCurrentPhase('Ready!');
      setTimeout(onComplete, 1000);
    };

    const updateModelProgress = (index: number, duration: number) => {
      return new Promise<void>((resolve) => {
        setModels(prev => {
          const updated = [...prev];
          updated[index].status = 'downloading';
          return updated;
        });

        let progress = 0;
        const interval = setInterval(() => {
          progress += Math.random() * 10;
          if (progress >= 100) {
            progress = 100;
            clearInterval(interval);
            
            setModels(prev => {
              const updated = [...prev];
              updated[index].status = 'ready';
              updated[index].progress = 100;
              return updated;
            });
            
            setOverallProgress(((index + 1) / 3) * 100);
            resolve();
          } else {
            setModels(prev => {
              const updated = [...prev];
              updated[index].progress = progress;
              return updated;
            });
          }
        }, duration / 10);
      });
    };

    simulateProgress();

    return () => clearInterval(factInterval);
  }, []);

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-dark-950 via-dark-900 to-primary-900 flex items-center justify-center z-50">
      <div className="max-w-2xl w-full px-8">
        {/* Header */}
        <div className="text-center mb-12 animate-fade-in">
          <div className="text-6xl mb-4 animate-bounce-slow">🤖</div>
          <h1 className="text-4xl font-bold text-white mb-3">
            AI Research Copilot
          </h1>
          <p className="text-primary-200 text-lg">
            Downloading private AI models to your browser
          </p>
        </div>

        {/* Model Status Cards */}
        <div className="space-y-4 mb-8">
          {models.map((model, index) => (
            <div
              key={index}
              className={`
                bg-dark-800/50 backdrop-blur-sm border rounded-xl p-5
                transition-all duration-500 transform
                ${model.status === 'downloading' ? 'border-primary-500 scale-105 shadow-lg shadow-primary-500/20' : 
                  model.status === 'ready' ? 'border-green-500' : 'border-dark-700'}
              `}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl">{model.icon}</span>
                  <div>
                    <h3 className="text-white font-semibold">{model.name}</h3>
                    <p className="text-dark-400 text-sm">{model.size}</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {model.status === 'pending' && (
                    <span className="text-dark-500 text-sm">Waiting...</span>
                  )}
                  {model.status === 'downloading' && (
                    <span className="text-primary-400 text-sm font-medium">
                      {Math.round(model.progress)}%
                    </span>
                  )}
                  {model.status === 'ready' && (
                    <span className="text-green-400 text-sm font-medium flex items-center">
                      <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Ready
                    </span>
                  )}
                </div>
              </div>
              
              {/* Progress Bar */}
              {model.status === 'downloading' && (
                <div className="w-full bg-dark-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-primary-400 transition-all duration-300 ease-out"
                    style={{ width: `${model.progress}%` }}
                  />
                </div>
              )}
              
              {model.status === 'ready' && (
                <div className="w-full bg-green-900/30 rounded-full h-2">
                  <div className="h-full bg-green-500 rounded-full w-full" />
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Overall Progress */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            <span className="text-white font-medium">{currentPhase}</span>
            <span className="text-primary-300 font-medium">{Math.round(overallProgress)}%</span>
          </div>
          <div className="w-full bg-dark-800 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-600 via-primary-500 to-primary-400 transition-all duration-500 ease-out"
              style={{ width: `${overallProgress}%` }}
            />
          </div>
        </div>

        {/* Fun Facts */}
        <div className="bg-dark-800/30 backdrop-blur-sm border border-dark-700 rounded-xl p-6 text-center">
          <p className="text-primary-200 text-lg transition-all duration-500 animate-pulse-slow">
            {funFacts[currentFactIndex]}
          </p>
        </div>

        {/* Spinner */}
        {overallProgress < 100 && (
          <div className="flex justify-center mt-8">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500" />
          </div>
        )}
      </div>
    </div>
  );
}

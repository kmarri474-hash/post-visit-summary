import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Brain, Stethoscope, Coffee, Zap, Search, ClipboardCheck } from "lucide-react";

const FUNNY_MESSAGES = [
    { text: "Consulting the digital oracle...", icon: Brain },
    { text: "Sharpening the virtual scalpel...", icon: Stethoscope },
    { text: "Bribing the AI with digital coffee...", icon: Coffee },
    { text: "Decoding clinician's handwriting (this might take a while)...", icon: Search },
    { text: "Applying digital band-aids to the data...", icon: Zap },
    { text: "Ensuring the AI has had its morning vitamins...", icon: Sparkles },
    { text: "Double-checking the Hippocratic Oath (Digital Edition)...", icon: ClipboardCheck },
    { text: "Polishing the artifacts for maximum shine...", icon: Sparkles },
    { text: "Teaching the agents how to spell 'Otolaryngology'...", icon: Brain },
    { text: "Calculating the optimal amount of bedside manner...", icon: Stethoscope },
];

export default function WaitingAnimation({ isRunning }: { isRunning: boolean }) {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (!isRunning) return;
        const interval = setInterval(() => {
            setIndex((prev) => (prev + 1) % FUNNY_MESSAGES.length);
        }, 3000);
        return () => clearInterval(interval);
    }, [isRunning]);

    if (!isRunning) return null;

    const { text, icon: Icon } = FUNNY_MESSAGES[index];

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center justify-center p-4 space-y-6"
        >
            <div className="text-center">
                <h3 className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold mb-1">
                    Agent is thinking
                </h3>
                <div className="h-1 w-12 bg-brand-gradient mx-auto rounded-full opacity-50" />
            </div>

            <div className="relative">
                <motion.div
                    animate={{
                        scale: [1, 1.2, 1],
                        rotate: [0, 10, -10, 0],
                    }}
                    transition={{
                        duration: 2,
                        repeat: Infinity,
                        ease: "easeInOut",
                    }}
                    className="w-16 h-16 bg-brand-gradient rounded-full flex items-center justify-center text-white shadow-lg ring-4 ring-brand-100 dark:ring-brand-900/30"
                >
                    <Icon className="w-8 h-8" />
                </motion.div>

                {/* Floating particles */}
                {[...Array(5)].map((_, i) => (
                    <motion.div
                        key={i}
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{
                            opacity: [0, 1, 0],
                            scale: [0, 1, 0],
                            x: (i - 2) * 30,
                            y: -50 - Math.random() * 30,
                        }}
                        transition={{
                            duration: 2,
                            repeat: Infinity,
                            delay: i * 0.4,
                        }}
                        className="absolute top-0 left-1/2 w-2 h-2 bg-accent-400 rounded-full"
                    />
                ))}
            </div>

            <div className="h-8 flex items-center justify-center">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={index}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.5 }}
                        className="text-sm font-medium text-slate-600 dark:text-slate-300 italic text-center"
                    >
                        {text}
                    </motion.p>
                </AnimatePresence>
            </div>
        </motion.div>
    );
}

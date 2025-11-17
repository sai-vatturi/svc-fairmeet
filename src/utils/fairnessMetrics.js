/**
 * Research-Grade Fairness Metrics
 * Based on paper: "FairMeet: A Human-Centered Meeting Moderation System"
 * 
 * Implements Gini coefficient calculation and related metrics
 */

/**
 * Calculate Gini Coefficient
 * Formula: G = Σ Σ |xi - xj| / (2n²x̄)
 * where xi = speaking time of participant i, x̄ = mean, n = participants
 * 
 * @param {number[]} speakingTimes - Array of speaking times in seconds
 * @returns {number} Gini coefficient (0 to 1, where 0 = perfect equality)
 */
export function calculateGiniCoefficient(speakingTimes) {
  if (!speakingTimes || speakingTimes.length === 0) return 0;
  if (speakingTimes.length === 1) return 0; // Single participant = perfect equality
  
  const n = speakingTimes.length;
  const sum = speakingTimes.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  
  // If no one has spoken yet, return 0 (perfect equality)
  if (mean === 0 || sum === 0) return 0;
  
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      giniSum += Math.abs(speakingTimes[i] - speakingTimes[j]);
    }
  }
  
  // Gini coefficient formula: G = Σ Σ |xi - xj| / (2n²x̄)
  return giniSum / (2 * n * n * mean);
}

/**
 * Calculate Fairness Score
 * F = 1 - G (ranges 0-1, higher = more fair)
 * 
 * @param {number[]} speakingTimes - Array of speaking times in seconds
 * @returns {number} Fairness score (0 to 1, where 1 = perfect fairness)
 */
export function calculateFairnessScore(speakingTimes) {
  if (!speakingTimes || speakingTimes.length === 0) return 1; // No participants = perfect fairness
  if (speakingTimes.length === 1) return 1; // Single participant = perfect fairness
  
  const gini = calculateGiniCoefficient(speakingTimes);
  // F = 1 - G (ranges 0-1, higher = more fair)
  return Math.max(0, Math.min(1, 1 - gini));
}

/**
 * Calculate Shannon Entropy for participation distribution
 * Higher entropy = more diverse participation
 * 
 * @param {number[]} speakingTimes - Array of speaking times in seconds
 * @returns {number} Entropy value
 */
export function calculateShannonEntropy(speakingTimes) {
  if (!speakingTimes || speakingTimes.length === 0) return 0;
  
  const total = speakingTimes.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  
  let entropy = 0;
  for (const time of speakingTimes) {
    if (time > 0) {
      const probability = time / total;
      entropy -= probability * Math.log2(probability);
    }
  }
  
  return entropy;
}

/**
 * Calculate Dominance Index
 * Ratio of maximum speaking time to total meeting duration
 * 
 * @param {number[]} speakingTimes - Array of speaking times
 * @param {number} meetingDuration - Total meeting duration in seconds
 * @returns {number} Dominance index (0 to 1)
 */
export function calculateDominanceIndex(speakingTimes, meetingDuration) {
  if (!speakingTimes || speakingTimes.length === 0 || meetingDuration === 0) return 0;
  const maxSpeakingTime = Math.max(...speakingTimes);
  return maxSpeakingTime / meetingDuration;
}

/**
 * Detect Long Turns
 * A long turn is continuous speaking exceeding threshold T (default 60s)
 * 
 * @param {number} continuousSpeakingTime - Current continuous speaking time in seconds
 * @param {number} threshold - Threshold in seconds (default 60)
 * @returns {object} Long turn detection result
 */
export function detectLongTurn(continuousSpeakingTime, threshold = 60) {
  return {
    isLongTurn: continuousSpeakingTime > threshold,
    duration: continuousSpeakingTime,
    shouldNudge: continuousSpeakingTime > threshold,
  };
}

/**
 * Comprehensive Fairness Analysis
 * Combines all metrics for research-grade analysis
 * 
 * @param {number[]} speakingTimes - Array of speaking times (excluding host)
 * @param {number} meetingDuration - Total meeting duration in seconds
 * @returns {object} Complete fairness analysis
 */
export function analyzeAdvancedFairness(speakingTimes, meetingDuration) {
  // Handle edge cases
  if (!speakingTimes || speakingTimes.length === 0) {
    return {
      giniCoefficient: 0,
      fairnessScore: 1,
      interpretation: 'excellent',
      participationEntropy: 0,
      dominanceIndex: 0,
      recommendations: ['No participants yet'],
    };
  }
  
  const giniCoefficient = calculateGiniCoefficient(speakingTimes);
  const fairnessScore = calculateFairnessScore(speakingTimes);
  const participationEntropy = calculateShannonEntropy(speakingTimes);
  const dominanceIndex = calculateDominanceIndex(speakingTimes, meetingDuration);
  
  // Generate interpretation
  let interpretation = 'excellent';
  if (fairnessScore < 0.6) {
    interpretation = 'needs_improvement';
  } else if (fairnessScore < 0.8) {
    interpretation = 'good';
  }
  
  // Generate recommendations
  const recommendations = generateRecommendations(speakingTimes, fairnessScore, dominanceIndex);
  
  return {
    giniCoefficient,
    fairnessScore,
    interpretation,
    participationEntropy,
    dominanceIndex,
    recommendations,
  };
}

/**
 * Generate evidence-based recommendations
 * 
 * @param {number[]} speakingTimes - Array of speaking times
 * @param {number} fairnessScore - Current fairness score
 * @param {number} dominanceIndex - Dominance index
 * @returns {string[]} Array of recommendation strings
 */
function generateRecommendations(speakingTimes, fairnessScore, dominanceIndex) {
  const recommendations = [];
  
  if (fairnessScore < 0.6) {
    recommendations.push('Significant participation imbalance detected. Consider inviting quieter voices.');
  }
  
  if (dominanceIndex > 0.4) {
    recommendations.push('One participant is dominating. Encourage turn-taking.');
  }
  
  const minTime = Math.min(...speakingTimes);
  const maxTime = Math.max(...speakingTimes);
  const ratio = maxTime / (minTime || 1);
  
  if (ratio > 3) {
    recommendations.push('Large gap between most and least active participants. Use queue system to balance.');
  }
  
  if (fairnessScore >= 0.8) {
    recommendations.push('Excellent participation balance! Keep up the good facilitation.');
  }
  
  return recommendations;
}

/**
 * Calculate speaking percentage for a participant
 * 
 * @param {number} participantTime - Participant's speaking time
 * @param {number[]} allTimes - All participants' speaking times
 * @param {boolean} excludeHost - Whether to exclude host from calculation
 * @returns {number} Percentage (0-100)
 */
export function calculateSpeakingPercentage(participantTime, allTimes, excludeHost = false) {
  const relevantTimes = excludeHost ? allTimes.slice(1) : allTimes;
  const total = relevantTimes.reduce((a, b) => a + b, 0);
  
  if (total === 0) return 0;
  return Math.round((participantTime / total) * 100);
}


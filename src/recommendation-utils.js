const readMoney = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
};

export function checkClassroomAge(childMonths, programs) {
  if (!Array.isArray(programs) || programs.length === 0) {
    return { status: 'unknown' };
  }

  const ranges = programs
    .map((program) => ({
      min: readMoney(program.minAgeMonths),
      max: readMoney(program.maxAgeMonths)
    }))
    .filter(({ min, max }) => min !== null && max !== null && min <= max);

  if (ranges.length === 0) return { status: 'unknown' };
  if (ranges.some(({ min, max }) => min <= childMonths && childMonths <= max)) {
    return { status: 'compatible' };
  }

  return { status: 'incompatible' };
}

export function getPublishedMonthlyRate(monthlyRates, ageCategory) {
  const categoryRates = monthlyRates?.[ageCategory];
  const min = readMoney(categoryRates?.min);
  const max = readMoney(categoryRates?.max);

  if (min === null && max === null) {
    return {
      status: 'unverified_blank_rates',
      min: null,
      max: null,
      conservativeGross: null,
      lowerBoundGross: null
    };
  }

  if (min !== null && max !== null) {
    if (max < min) {
      return {
        status: 'invalid_rates',
        min,
        max,
        conservativeGross: null,
        lowerBoundGross: null
      };
    }

    return {
      status: min === max ? 'verified' : 'verified_range',
      min,
      max,
      conservativeGross: max,
      lowerBoundGross: min
    };
  }

  if (max !== null) {
    return {
      status: 'verified_upper_bound',
      min: null,
      max,
      conservativeGross: max,
      lowerBoundGross: null
    };
  }

  return {
    status: 'partial_rate',
    min,
    max: null,
    conservativeGross: null,
    lowerBoundGross: min
  };
}

export function isRateSafeForBudget(rateStatus) {
  return ['verified', 'verified_range', 'verified_upper_bound'].includes(rateStatus);
}

export function rankCandidates(candidates, homeLocation) {
  return [...candidates].sort((a, b) => {
    const costA = a.estimatedNetOutOfPocketMonthly ?? Number.MAX_SAFE_INTEGER;
    const costB = b.estimatedNetOutOfPocketMonthly ?? Number.MAX_SAFE_INTEGER;
    if (homeLocation) {
      const distanceA = a.distanceMiles ?? Number.MAX_SAFE_INTEGER;
      const distanceB = b.distanceMiles ?? Number.MAX_SAFE_INTEGER;
      if (Math.abs(distanceA - distanceB) > 1.5) return distanceA - distanceB;
    }
    return costA - costB;
  });
}

export function estimateOutOfPocket(rate, subsidyAmount, freeTuition = false) {
  const subsidy = readMoney(subsidyAmount) ?? 0;
  if (freeTuition) {
    return {
      min: 0,
      max: 0,
      estimate: 0,
      basis: 'free_tuition_policy_conditional'
    };
  }

  const min = rate.lowerBoundGross === null
    ? null
    : Math.max(0, rate.lowerBoundGross - subsidy);
  const max = rate.conservativeGross === null
    ? null
    : Math.max(0, rate.conservativeGross - subsidy);

  return {
    min,
    max,
    estimate: isRateSafeForBudget(rate.status) ? max : null,
    basis: isRateSafeForBudget(rate.status)
      ? 'published_rate_minus_applicable_credit'
      : 'unverified_or_incomplete_rate'
  };
}

export function summarizeInspectionRecord(facility) {
  const count = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const sumRequired = (...values) => {
    const parsed = values.map(count);
    return parsed.some((value) => value === null)
      ? null
      : parsed.reduce((sum, value) => sum + value, 0);
  };
  const firstKnown = (...values) => {
    for (const value of values) {
      const parsed = count(value);
      if (parsed !== null) return parsed;
    }
    return null;
  };

  const f = facility || {};
  // CCLD reports citations per visit type: inspection (NBRINSP*), complaint (NBRCMPLT*),
  // and other visits (NBROTHER*). TOTTYPEA/TOTTYPEB summarize the complaint array and
  // duplicate NBRCMPLTTYPA/B, so adding them would double-count complaint citations.
  const totalTypeA = sumRequired(f.NBRINSPTYPA, f.NBRCMPLTTYPA, f.NBROTHERTYPA);
  const totalTypeB = sumRequired(f.NBRINSPTYPB, f.NBRCMPLTTYPB, f.NBROTHERTYPB);
  const complaintVisits = firstKnown(f.NBRCMPLTVISITS, f.TOTCMPVISITS);
  const substantiatedAllegations = count(f.TOTSUBALG);
  const status = typeof f.STATUS === 'string' && f.STATUS.trim()
    ? f.STATUS.trim()
    : null;
  const countsComplete = [
    totalTypeA,
    totalTypeB,
    complaintVisits,
    substantiatedAllegations
  ].every((value) => value !== null);

  let rating = 'unknown';
  let safetySummary = 'Inspection findings are unavailable or incomplete.';

  if (status && countsComplete) {
    rating = 'pristine';
    safetySummary = 'No citations or complaint visits in the CCLD public record.';

    if (status.toLowerCase() !== 'licensed') {
      rating = 'caution';
      safetySummary = 'License status is ' + status + '; this facility is not currently confirmed as licensed.';
    }

    if (status.toLowerCase() === 'licensed' &&
        (totalTypeA > 0 || substantiatedAllegations > 0)) {
      rating = 'caution';
      safetySummary = 'Caution: ' + totalTypeA + ' Type A citations and/or ' +
        substantiatedAllegations + ' substantiated complaint allegations.';
    } else if (status.toLowerCase() === 'licensed' &&
        (totalTypeB > 2 || complaintVisits > 2)) {
      rating = 'notable_citations';
      safetySummary = 'Notice: ' + totalTypeB + ' Type B citations and ' +
        complaintVisits + ' complaint visits on file.';
    } else if (status.toLowerCase() === 'licensed' &&
        (totalTypeB > 0 || complaintVisits > 0)) {
      rating = 'minor_findings';
      safetySummary = 'Minor findings: ' + totalTypeB + ' Type B citations and ' +
        complaintVisits + ' complaint visits (no substantiated allegations).';
    }
  }

  return {
    status,
    verificationStatus: status ? 'verified' : 'incomplete',
    inspectionDataStatus: countsComplete ? 'complete' : 'incomplete',
    capacity: count(f.CAPACITY),
    lastVisitDate: f.LASTVISITDATE || null,
    complaintVisits,
    substantiatedAllegations,
    totalTypeA,
    totalTypeB,
    rating,
    safetySummary,
    comments: (f.COMMENTS || '') + (f.COMMENTS2 ? ' ' + f.COMMENTS2 : ''),
    isToddlerOptionExplicit: /toddler/i.test((f.COMMENTS || '') + (f.COMMENTS2 || ''))
  };
}

export function isVerifiedLicensedFacility(ccld) {
  return ccld?.verificationStatus === 'verified' &&
    ccld?.inspectionDataStatus === 'complete' &&
    String(ccld.status || '').trim().toLowerCase() === 'licensed';
}

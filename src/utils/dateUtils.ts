export const getFormattedWeekday = (date: Date = new Date()): string => {
    const day = date.toLocaleDateString('ar-EG', { weekday: 'long' });
    const mapping: Record<string, string> = {
        'الاثنين': 'الاثنين',
        'الاربعاء': 'الاربعاء',
        'الاحد': 'الاحد',
    };
    return mapping[day] || day;
};

const toValidDate = (input: Date | number | string | undefined | null): Date | null => {
    if (input === undefined || input === null || input === '') return null;
    const d = input instanceof Date ? input : new Date(input);
    return isNaN(d.getTime()) ? null : d;
};

export const formatEnglishDate = (
    input: Date | number | string | undefined | null,
    fallback = ''
): string => {
    const d = toValidDate(input);
    if (!d) return fallback;
    try {
        return d.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    } catch {
        return fallback;
    }
};

export const formatEnglishTime = (
    input: Date | number | string | undefined | null,
    includeSeconds = false,
    fallback = ''
): string => {
    const d = toValidDate(input);
    if (!d) return fallback;
    try {
        return d.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            ...(includeSeconds ? { second: '2-digit' } : {}),
            hour12: true,
        });
    } catch {
        return fallback;
    }
};

export const formatEnglishDateTime = (
    input: Date | number | string | undefined | null,
    fallback = '',
    includeSeconds = true
): string => {
    const d = toValidDate(input);
    if (!d) return fallback;
    const datePart = formatEnglishDate(d, fallback);
    const timePart = formatEnglishTime(d, includeSeconds, '');
    return datePart && timePart ? `${datePart} ${timePart}` : datePart || fallback;
};

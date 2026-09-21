export const getFormattedWeekday = (date: Date = new Date()): string => {
    const day = date.toLocaleDateString('ar-EG', { weekday: 'long' });
    const mapping: Record<string, string> = {
        'الاثنين': 'الإثنين',
        'الاربعاء': 'الأربعاء',
        'الاحد': 'الأحد',
    };
    return mapping[day] || day;
};

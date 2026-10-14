export const getFormattedWeekday = (date: Date = new Date()): string => {
    const day = date.toLocaleDateString('ar-EG', { weekday: 'long' });
    const mapping: Record<string, string> = {
        'الاثنين': 'الاثنين',
        'الاربعاء': 'الاربعاء',
        'الاحد': 'الاحد',
    };
    return mapping[day] || day;
};

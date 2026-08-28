import re

with open('src/context/SalesContext.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove TWELVE_HOURS_MS definition
content = re.sub(r'const TWELVE_HOURS_MS = 12 \* 60 \* 60 \* 1000;\n', '', content)

# 2. Fix saveSalesEntries cutoff logic
old_save_sales = """    const cutoff = Date.now() - TWELVE_HOURS_MS;
    const prevWeight = salesEntries
      .filter(
        (e) =>
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.dateString === selectedDate &&
          e.timestamp >= cutoff
      )"""
new_save_sales = """    const prevWeight = salesEntries
      .filter(
        (e) =>
          e.delegateName?.trim().toLowerCase() === activeDelegateName?.trim().toLowerCase() &&
          e.dateString === selectedDate
      )"""
content = content.replace(old_save_sales, new_save_sales)

# 3. Fix rawSavedEntries logic
old_raw_saved = """  const rawSavedEntries = useMemo(() => {
    const cutoff = Date.now() - TWELVE_HOURS_MS;
    return salesEntries.filter((entry) => entry.dateString === selectedDate && entry.timestamp >= cutoff);
  }, [salesEntries, selectedDate]);"""
new_raw_saved = """  const rawSavedEntries = useMemo(() => {
    return salesEntries.filter((entry) => entry.dateString === selectedDate);
  }, [salesEntries, selectedDate]);"""
content = content.replace(old_raw_saved, new_raw_saved)

# 4. Remove clean12HourExpiredEntries and manualReset12HourReport implementations
old_cleanup = """  const manualReset12HourReport = () => {
    const activeDel = currentUser.isAdmin ? selectedDelegate : currentUser.name;
    if (activeDel === 'الكل' || currentUser.isAdmin) {
      setSalesEntries([]);
      setUserMessage('تم تصفير تقارير المبيعات بنجاح');
    } else {
      setSalesEntries((prev) =>
        prev.filter((e) => e.delegateName?.trim().toLowerCase() !== activeDel?.trim().toLowerCase())
      );
      setUserMessage(`تم تصفير تقرير المبيعات لـ (${activeDel})`);
    }
  };

  const clean12HourExpiredEntries = () => {
    const cutoff = Date.now() - TWELVE_HOURS_MS;
    setSalesEntries((prev) => prev.filter((e) => e.timestamp >= cutoff));
  };"""

content = content.replace(old_cleanup, '')

# 5. Remove them from the interface and context return
content = re.sub(r'\s*manualReset12HourReport:\s*\(\)\s*=>\s*void;', '', content)
content = re.sub(r'\s*clean12HourExpiredEntries:\s*\(\)\s*=>\s*void;', '', content)
content = re.sub(r'\s*manualReset12HourReport,', '', content)
content = re.sub(r'\s*clean12HourExpiredEntries,', '', content)

with open('src/context/SalesContext.tsx', 'w', encoding='utf-8') as f:
    f.write(content)


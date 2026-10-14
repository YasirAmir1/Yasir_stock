import re

with open('src/components/EntryScreen.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_end = """                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};"""

new_end = """                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};"""

content = content.replace(old_end, new_end)

with open('src/components/EntryScreen.tsx', 'w', encoding='utf-8') as f:
    f.write(content)


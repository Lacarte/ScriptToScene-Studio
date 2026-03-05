font_paths = ['C:/Windows/Fonts/Inter-Regular.ttf', 'arial.ttf']
print("Start")
count = 0
for path in font_paths:
    count += 1
    # simulate the buggy code
    bold_path = path.replace('-Regular', '-Bold').replace('.ttf', '')
    if '-Bold' not in bold_path:
        bold_path = path.rsplit('.', 1)[0] + '-Bold.ttf'
    font_paths.insert(0, bold_path)
    if count > 10:
        print("Infinite loop detected!")
        break
print(font_paths)

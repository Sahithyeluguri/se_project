from selenium import webdriver
from selenium.webdriver.common.by import By
import time

# Start browser
driver = webdriver.Chrome()

# Open your login page
driver.get("http://localhost:5000/login")

results = []

def test_valid_login():
    driver.find_element(By.NAME, "username").send_keys("admin")
    driver.find_element(By.NAME, "password").send_keys("admin123")
    driver.find_element(By.TAG_NAME, "button").click()
    time.sleep(2)

    if "dashboard" in driver.current_url:
        return "PASS"
    return "FAIL"

def test_invalid_login():
    driver.get("http://localhost:5000/login")
    driver.find_element(By.NAME, "username").send_keys("admin")
    driver.find_element(By.NAME, "password").send_keys("wrong")
    driver.find_element(By.TAG_NAME, "button").click()
    time.sleep(2)

    error = driver.page_source
    if "Invalid" in error:
        return "PASS"
    return "FAIL"

# Run tests
results.append(("Valid Login", test_valid_login()))
results.append(("Invalid Login", test_invalid_login()))

# Print results
print("\nTest Results:")
for test, result in results:
    print(f"{test}: {result}")

driver.quit()
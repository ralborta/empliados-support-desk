// Mobile menu toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileNav = document.getElementById('mobile-nav');

if (mobileMenuBtn && mobileNav) {
  mobileMenuBtn.addEventListener('click', () => {
    mobileNav.classList.toggle('active');
    const icon = mobileMenuBtn.querySelector('.material-symbols-outlined');
    if (icon) {
      icon.textContent = mobileNav.classList.contains('active') ? 'close' : 'menu';
    }
  });
  
  // Close mobile menu when clicking a link
  const mobileNavLinks = mobileNav.querySelectorAll('.nav-link');
  mobileNavLinks.forEach(link => {
    link.addEventListener('click', () => {
      mobileNav.classList.remove('active');
      const icon = mobileMenuBtn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.textContent = 'menu';
      }
    });
  });
}

// Active nav link on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-link');

function highlightNavOnScroll() {
  const scrollY = window.pageYOffset;
  
  sections.forEach(section => {
    const sectionHeight = section.offsetHeight;
    const sectionTop = section.offsetTop - 100;
    const sectionId = section.getAttribute('id');
    
    if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
      navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${sectionId}`) {
          link.classList.add('active');
        }
      });
    }
  });
}

window.addEventListener('scroll', highlightNavOnScroll);
highlightNavOnScroll(); // Run on load

// FAQ Accordion
const faqQuestions = document.querySelectorAll('.faq-question');

faqQuestions.forEach(question => {
  question.addEventListener('click', () => {
    const faqItem = question.closest('.faq-item');
    if (!faqItem) return;
    const isActive = faqItem.classList.contains('active');
    
    // Close all other FAQ items
    document.querySelectorAll('.faq-item').forEach(item => {
      item.classList.remove('active');
      const btn = item.querySelector('.faq-question');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    
    // Toggle current item
    if (!isActive) {
      faqItem.classList.add('active');
      question.setAttribute('aria-expanded', 'true');
    }
  });
});

// Fix for anchor navigation: reveal sections immediately when in viewport on load or hashchange
function revealVisibleSections() {
  const sections = document.querySelectorAll('section');
  const viewportHeight = window.innerHeight;
  
  sections.forEach(section => {
    const rect = section.getBoundingClientRect();
    // Check if section is in viewport (with some margin)
    if (rect.top < viewportHeight && rect.bottom > 0) {
      section.style.opacity = '1';
      section.style.visibility = 'visible';
      section.style.transform = 'none';
    }
  });
}

// Run on page load
window.addEventListener('load', () => {
  revealVisibleSections();
  
  // Also run after a short delay to ensure everything is ready
  setTimeout(revealVisibleSections, 100);
});

// Run on hash change (when clicking anchor links)
window.addEventListener('hashchange', () => {
  setTimeout(revealVisibleSections, 50);
});

// Run immediately if hash is present in URL
if (window.location.hash) {
  setTimeout(revealVisibleSections, 100);
}

---
layout: page
icon: fas fa-city
order: 1
title: 부동산 이야기
---

{% assign posts = site.posts | where_exp: "p", "p.categories contains '부동산'" %}
{% if posts.size > 0 %}
<ul class="post-list">
  {% for post in posts %}
  <li>
    <a href="{{ post.url | relative_url }}">{{ post.title }}</a>
    <span class="post-meta">{{ post.date | date: '%Y-%m-%d' }}</span>
  </li>
  {% endfor %}
</ul>
{% else %}
<p>아직 글이 없습니다.</p>
{% endif %}

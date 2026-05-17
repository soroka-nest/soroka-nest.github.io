---
layout: page
icon: fas fa-camera
order: 2
title: 일상 생활
---

{% assign posts = site.posts | where_exp: "p", "p.categories contains '둥지 일상'" %}
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
